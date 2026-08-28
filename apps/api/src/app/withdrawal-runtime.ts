import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Kafka } from 'kafkajs';
import { Pool } from 'pg';
import { createClient } from 'redis';
import {
  FinalizeReservation,
  ReleaseReservation,
  ReserveFunds,
} from '@bitex/wallet';
import {
  ExecuteWithdrawal,
  GetWithdrawal,
  RequestWithdrawal,
} from '@bitex/withdrawal';
import { PostgresTransactionRunner } from '../infrastructure/database/postgres-transaction-runner.js';
import { PostgresWalletRepository } from '../infrastructure/database/postgres-wallet-repository.js';
import { PostgresWithdrawalRepository } from '../infrastructure/database/postgres-withdrawal-repository.js';
import { PostgresWithdrawalIdempotency } from '../infrastructure/database/postgres-idempotency.js';
import { PostgresOutbox } from '../infrastructure/database/postgres-outbox.js';
import { PostgresProcessedEvents } from '../infrastructure/database/postgres-processed-events.js';
import { PostgresWithdrawalQuery } from '../infrastructure/database/postgres-withdrawal-query.js';
import { PostgresFakeWithdrawalProvider } from '../infrastructure/provider/postgres-fake-withdrawal-provider.js';
import { RedisRateLimiter } from '../infrastructure/redis/redis-rate-limiter.js';
import { OutboxPublisher } from '../infrastructure/messaging/outbox-publisher.js';
import { WithdrawalExecutionConsumer } from '../infrastructure/messaging/withdrawal-execution-consumer.js';

@Injectable()
export class WithdrawalRuntime implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WithdrawalRuntime.name);
  private readonly pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://pooleno:pooleno@localhost:5432/pooleno',
  });
  private readonly redis = createClient({
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  });
  private readonly kafka = new Kafka({
    clientId: 'pooleno-withdrawal',
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  });
  private readonly transaction = new PostgresTransactionRunner(this.pool);
  private readonly walletRepository = new PostgresWalletRepository(
    this.transaction,
  );
  private readonly withdrawalRepository = new PostgresWithdrawalRepository(
    this.transaction,
  );
  private readonly reserveFunds = new ReserveFunds(this.walletRepository, {
    next: randomUUID,
  });
  private readonly finalizeReservation = new FinalizeReservation(
    this.walletRepository,
  );
  private readonly releaseReservation = new ReleaseReservation(
    this.walletRepository,
  );
  private readonly processedEvents = new PostgresProcessedEvents(
    this.transaction,
  );
  private readonly provider = new PostgresFakeWithdrawalProvider(
    this.pool,
    () => process.env.FAKE_PROVIDER_OUTCOME === 'FAILED',
  );
  private readonly topic =
    process.env.KAFKA_TOPIC ?? 'withdrawal-execution-requested';
  private readonly publisher = new OutboxPublisher(
    this.pool,
    this.kafka.producer(),
    this.topic,
  );
  private readonly consumer = new WithdrawalExecutionConsumer(
    this.kafka.consumer({ groupId: 'withdrawal-executors' }),
    this.topic,
    new ExecuteWithdrawal({
      transactionRunner: this.transaction,
      withdrawals: this.withdrawalRepository,
      processedEvents: this.processedEvents,
      walletSettlement: {
        finalize: (reservationId) =>
          this.finalizeReservation.execute(reservationId),
        release: (reservationId) =>
          this.releaseReservation.execute(reservationId),
      },
      provider: this.provider,
      clock: { now: () => new Date() },
    }),
  );

  readonly requestWithdrawal = new RequestWithdrawal({
    transactionRunner: this.transaction,
    idempotency: new PostgresWithdrawalIdempotency(this.transaction),
    walletReservation: {
      reserve: (input) => this.reserveFunds.execute(input),
    },
    withdrawals: this.withdrawalRepository,
    outbox: new PostgresOutbox(this.transaction),
    withdrawalIdGenerator: { next: randomUUID },
    eventIdGenerator: { next: randomUUID },
    clock: { now: () => new Date() },
  });
  readonly getWithdrawal = new GetWithdrawal(
    new PostgresWithdrawalQuery(this.pool),
  );
  readonly rateLimiter = new RedisRateLimiter(this.redis);

  async onModuleInit(): Promise<void> {
    await this.pool.query('SELECT 1');
    this.redis.on('error', (error) =>
      this.logger.warn({
        operation: 'redis',
        result: 'unavailable',
        errorCode: error.name,
      }),
    );
    try {
      await this.redis.connect();
    } catch (error) {
      this.logger.warn({
        operation: 'redis-connect',
        result: 'fail-open',
        errorCode: (error as Error).name,
      });
    }
    if (process.env.ENABLE_MESSAGING === 'true') {
      await this.publisher.start();
      await this.consumer.start();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (process.env.ENABLE_MESSAGING === 'true') {
      await this.consumer.stop();
      await this.publisher.stop();
    }
    if (this.redis.isOpen) await this.redis.disconnect();
    await this.pool.end();
  }
}
