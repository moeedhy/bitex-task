import { Module } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import { ExecuteWithdrawal, RecoverStuckWithdrawals } from '@bitex/withdrawal';
import { DatabaseConnection } from '../infrastructure/shared/database-connection.js';
import { KafkaDeadLetterSink } from '../infrastructure/messaging/kafka-dead-letter-sink.js';
import { OutboxPublisher } from '../infrastructure/messaging/outbox-publisher.js';
import { WithdrawalExecutionConsumer } from '../infrastructure/messaging/withdrawal-execution-consumer.js';
import { StuckWithdrawalRecoveryWorker } from '../infrastructure/jobs/stuck-withdrawal-recovery-worker.js';
import { envNumber, envString } from './env.js';
import { PersistenceModule } from './persistence.module.js';
import { WithdrawalModule } from './withdrawal.module.js';

const topic = () =>
  envString(process.env.KAFKA_TOPIC, 'withdrawal-execution-requested');

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
  private readonly enabled = process.env.ENABLE_MESSAGING === 'true';

  constructor(
    private readonly publisher: OutboxPublisher,
    private readonly deadLetters: KafkaDeadLetterSink,
    private readonly consumer: WithdrawalExecutionConsumer,
    private readonly recovery: StuckWithdrawalRecoveryWorker,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      return;
    }
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
  imports: [PersistenceModule, WithdrawalModule],
  providers: [
    {
      provide: Kafka,
      useFactory: () =>
        new Kafka({
          clientId: 'pooleno-withdrawal',
          brokers: envString(process.env.KAFKA_BROKERS, 'localhost:9092').split(
            ',',
          ),
        }),
    },
    {
      provide: OutboxPublisher,
      inject: [DatabaseConnection, Kafka],
      useFactory: (database: DatabaseConnection, kafka: Kafka) =>
        new OutboxPublisher(database.pool, kafka.producer(), topic(), {
          intervalMs: envNumber(process.env.OUTBOX_POLL_INTERVAL_MS, 1_000),
          retentionMs: envNumber(
            process.env.OUTBOX_RETENTION_MS,
            7 * 24 * 60 * 60 * 1000,
          ),
        }),
    },
    {
      provide: KafkaDeadLetterSink,
      inject: [Kafka],
      useFactory: (kafka: Kafka) =>
        new KafkaDeadLetterSink(
          kafka.producer(),
          envString(process.env.KAFKA_DLQ_TOPIC, `${topic()}.dlq`),
        ),
    },
    {
      provide: WithdrawalExecutionConsumer,
      inject: [Kafka, ExecuteWithdrawal, KafkaDeadLetterSink],
      useFactory: (
        kafka: Kafka,
        executeWithdrawal: ExecuteWithdrawal,
        deadLetters: KafkaDeadLetterSink,
      ) =>
        new WithdrawalExecutionConsumer(
          kafka.consumer({ groupId: 'withdrawal-executors' }),
          topic(),
          executeWithdrawal,
          deadLetters,
        ),
    },
    {
      provide: StuckWithdrawalRecoveryWorker,
      inject: [RecoverStuckWithdrawals],
      useFactory: (recover: RecoverStuckWithdrawals) =>
        new StuckWithdrawalRecoveryWorker(
          recover,
          envNumber(process.env.WITHDRAWAL_RECOVERY_INTERVAL_MS, 60_000),
        ),
    },
    {
      provide: MessagingLifecycle,
      inject: [
        OutboxPublisher,
        KafkaDeadLetterSink,
        WithdrawalExecutionConsumer,
        StuckWithdrawalRecoveryWorker,
      ],
      useFactory: (
        publisher: OutboxPublisher,
        deadLetters: KafkaDeadLetterSink,
        consumer: WithdrawalExecutionConsumer,
        recovery: StuckWithdrawalRecoveryWorker,
      ) =>
        new MessagingLifecycle(publisher, deadLetters, consumer, recovery),
    },
  ],
})
export class MessagingModule {}
