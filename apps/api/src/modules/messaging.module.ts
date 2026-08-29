import { Module } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import { provide, token } from '@bitex/platform/nest';
import {
  EXECUTE_WITHDRAWAL,
  RECOVER_STUCK_WITHDRAWALS,
} from '@bitex/withdrawal/nest';
import { StuckWithdrawalRecoveryWorker } from '../adapters/jobs/stuck-withdrawal-recovery-worker.js';
import { KafkaDeadLetterSink } from '../adapters/messaging/kafka-dead-letter-sink.js';
import { KafkaTopicProvisioner } from '../adapters/messaging/kafka-topic-provisioner.js';
import { OutboxPublisher } from '../adapters/messaging/outbox-publisher.js';
import { WithdrawalExecutionConsumer } from '../adapters/messaging/withdrawal-execution-consumer.js';
import { APP_CONFIG } from '../config/config.module.js';
import { DATABASE, PersistenceModule } from './persistence.module.js';
import { WithdrawalContextModule } from './withdrawal-context.module.js';

const KAFKA = token<Kafka>('Kafka');
const PUBLISHER = token<OutboxPublisher>('OutboxPublisher');
const DEAD_LETTERS = token<KafkaDeadLetterSink>('KafkaDeadLetterSink');
const CONSUMER = token<WithdrawalExecutionConsumer>('WithdrawalExecutionConsumer');
const RECOVERY = token<StuckWithdrawalRecoveryWorker>('RecoveryWorker');
const TOPICS = token<KafkaTopicProvisioner>('KafkaTopicProvisioner');
const LIFECYCLE = token<MessagingLifecycle>('MessagingLifecycle');

/**
 * Starts and stops the three background processes together.
 *
 * They are gated by `ENABLE_MESSAGING` so tests and local HTTP-only runs do not
 * require a broker. Shutdown is ordered: consumers and workers stop before the
 * producers they might still be writing through.
 *
 * Teardown deliberately runs in `onModuleDestroy`, the *earliest* shutdown hook.
 * Nest's order is `onModuleDestroy` -> `beforeApplicationShutdown` -> HTTP close
 * -> `onApplicationShutdown`, and everything here holds a PostgreSQL connection:
 * the consumer executes withdrawals, the publisher polls the outbox every
 * second, the worker scans for stuck rows. Closing the pool first — which is
 * what happened while this ran in `onApplicationShutdown` and the pool closed in
 * `onModuleDestroy` — leaves all three querying a dead pool, and the publisher's
 * unguarded interval then takes the process down mid-shutdown.
 */
export class MessagingLifecycle implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly enabled: boolean,
    private readonly topics: KafkaTopicProvisioner,
    private readonly publisher: OutboxPublisher,
    private readonly deadLetters: KafkaDeadLetterSink,
    private readonly consumer: WithdrawalExecutionConsumer,
    private readonly recovery: StuckWithdrawalRecoveryWorker,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    // Before anything connects: a producer's first metadata request against a
    // topic that does not exist fails the boot.
    await this.topics.provision();
    await this.publisher.start();
    await this.deadLetters.start();
    await this.consumer.start();
    this.recovery.start();
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    this.recovery.stop();
    await this.consumer.stop();
    await this.deadLetters.stop();
    await this.publisher.stop();
  }
}

@Module({
  imports: [PersistenceModule, WithdrawalContextModule],
  providers: [
    provide(
      KAFKA,
      [APP_CONFIG],
      (config) =>
        new Kafka({
          clientId: config.KAFKA_CLIENT_ID,
          brokers: config.KAFKA_BROKERS.split(','),
        }),
    ),
    provide(
      PUBLISHER,
      [DATABASE, KAFKA, APP_CONFIG],
      (database, kafka, config) =>
        new OutboxPublisher(database.pool, kafka.producer(), config.KAFKA_TOPIC, {
          intervalMs: config.OUTBOX_POLL_INTERVAL_MS,
          retentionMs: config.OUTBOX_RETENTION_MS,
          pruneIntervalMs: config.OUTBOX_PRUNE_INTERVAL_MS,
          batchSize: config.OUTBOX_BATCH_SIZE,
          leaseSeconds: config.OUTBOX_LEASE_SECONDS,
        }),
    ),
    provide(
      DEAD_LETTERS,
      [KAFKA, APP_CONFIG],
      (kafka, config) =>
        new KafkaDeadLetterSink(kafka.producer(), config.kafkaDlqTopic),
    ),
    provide(
      CONSUMER,
      [KAFKA, EXECUTE_WITHDRAWAL, DEAD_LETTERS, APP_CONFIG],
      (kafka, executeWithdrawal, deadLetters, config) =>
        new WithdrawalExecutionConsumer(
          kafka.consumer({ groupId: config.KAFKA_CONSUMER_GROUP }),
          config.KAFKA_TOPIC,
          executeWithdrawal,
          deadLetters,
          {
            maxAttempts: config.CONSUMER_MAX_ATTEMPTS,
            backoffMs: config.CONSUMER_BACKOFF_MS,
          },
        ),
    ),
    provide(
      RECOVERY,
      [RECOVER_STUCK_WITHDRAWALS, APP_CONFIG],
      (recover, config) =>
        new StuckWithdrawalRecoveryWorker(
          recover,
          config.WITHDRAWAL_RECOVERY_INTERVAL_MS,
        ),
    ),
    provide(TOPICS, [KAFKA, APP_CONFIG], (kafka, config) => {
      const spec = {
        partitions: config.KAFKA_TOPIC_PARTITIONS,
        replicationFactor: config.KAFKA_TOPIC_REPLICATION_FACTOR,
      };
      return new KafkaTopicProvisioner(kafka, [
        { topic: config.KAFKA_TOPIC, ...spec },
        // The dead-letter topic takes one partition: nothing consumes it
        // automatically, and ordering across dead letters means nothing.
        { topic: config.kafkaDlqTopic, ...spec, partitions: 1 },
      ]);
    }),
    provide(
      LIFECYCLE,
      [APP_CONFIG, TOPICS, PUBLISHER, DEAD_LETTERS, CONSUMER, RECOVERY],
      (config, topics, publisher, deadLetters, consumer, recovery) =>
        new MessagingLifecycle(
          config.ENABLE_MESSAGING,
          topics,
          publisher,
          deadLetters,
          consumer,
          recovery,
        ),
    ),
  ],
})
export class MessagingModule {}
