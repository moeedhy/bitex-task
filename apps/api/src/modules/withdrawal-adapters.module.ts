import { Module } from '@nestjs/common';
import { OUTBOX, provide } from '@bitex/platform/nest';
import { RESERVE_FUNDS, SETTLE_RESERVATION, WalletModule } from '@bitex/wallet/nest';
import {
  PROCESSED_EVENTS,
  STUCK_WITHDRAWAL_QUERY,
  WALLET_RESERVATION,
  WALLET_SETTLEMENT,
  WITHDRAWAL_IDEMPOTENCY,
  WITHDRAWAL_PROVIDER,
  WITHDRAWAL_QUERY,
  WITHDRAWAL_RECOVERY_OPTIONS,
  WITHDRAWAL_REPOSITORY,
} from '@bitex/withdrawal/nest';
import { PostgresOutbox } from '../adapters/shared/postgres-outbox.js';
import {
  WalletReservationAdapter,
  WalletSettlementAdapter,
} from '../adapters/wallet/wallet-capability.adapters.js';
import { PostgresFakeWithdrawalProvider } from '../adapters/withdrawal/postgres-fake-withdrawal-provider.js';
import { PostgresProcessedEvents } from '../adapters/withdrawal/postgres-processed-events.js';
import { PostgresWithdrawalIdempotency } from '../adapters/withdrawal/postgres-idempotency.js';
import { PostgresStuckWithdrawalQuery } from '../adapters/withdrawal/postgres-stuck-withdrawal-query.js';
import { PostgresWithdrawalQuery } from '../adapters/withdrawal/postgres-withdrawal-query.js';
import { PostgresWithdrawalRepository } from '../adapters/withdrawal/postgres-withdrawal-repository.js';
import { APP_CONFIG } from '../config/config.module.js';
import {
  DATABASE,
  PersistenceModule,
  TRANSACTIONAL_CLIENT,
} from './persistence.module.js';
import { WalletAdaptersModule } from './wallet-adapters.module.js';

/**
 * Everything the Withdrawal context needs, bound to something concrete.
 *
 * This is also the only place that knows both bounded contexts: the two
 * capability adapters translate Wallet use cases into the ports Withdrawal
 * declared. Neither library imports the other.
 */
@Module({
  imports: [
    PersistenceModule,
    WalletModule.forRoot({ imports: [WalletAdaptersModule] }),
  ],
  providers: [
    provide(
      WITHDRAWAL_REPOSITORY,
      [TRANSACTIONAL_CLIENT],
      (transaction) => new PostgresWithdrawalRepository(transaction),
    ),
    provide(
      WITHDRAWAL_IDEMPOTENCY,
      [TRANSACTIONAL_CLIENT],
      (transaction) => new PostgresWithdrawalIdempotency(transaction),
    ),
    provide(
      OUTBOX,
      [TRANSACTIONAL_CLIENT],
      (transaction) => new PostgresOutbox(transaction),
    ),
    provide(
      PROCESSED_EVENTS,
      [TRANSACTIONAL_CLIENT],
      (transaction) => new PostgresProcessedEvents(transaction),
    ),
    provide(
      STUCK_WITHDRAWAL_QUERY,
      [TRANSACTIONAL_CLIENT],
      (transaction) => new PostgresStuckWithdrawalQuery(transaction),
    ),
    // Reads bypass the transaction runner: a query that takes no row lock has
    // no reason to join a transaction.
    provide(
      WITHDRAWAL_QUERY,
      [DATABASE],
      (database) => new PostgresWithdrawalQuery(database.pool),
    ),
    provide(
      WITHDRAWAL_PROVIDER,
      [DATABASE, APP_CONFIG],
      (database, config) =>
        new PostgresFakeWithdrawalProvider(
          database.pool,
          () => config.FAKE_PROVIDER_OUTCOME === 'FAILED',
        ),
    ),
    provide(
      WALLET_RESERVATION,
      [RESERVE_FUNDS],
      (reserveFunds) => new WalletReservationAdapter(reserveFunds),
    ),
    provide(
      WALLET_SETTLEMENT,
      [SETTLE_RESERVATION],
      (settle) => new WalletSettlementAdapter(settle),
    ),
    provide(WITHDRAWAL_RECOVERY_OPTIONS, [APP_CONFIG], (config) => ({
      processingTimeoutMs: config.WITHDRAWAL_PROCESSING_TIMEOUT_MS,
      batchSize: config.WITHDRAWAL_RECOVERY_BATCH_SIZE,
    })),
  ],
  exports: [
    OUTBOX,
    PROCESSED_EVENTS,
    STUCK_WITHDRAWAL_QUERY,
    WALLET_RESERVATION,
    WALLET_SETTLEMENT,
    WITHDRAWAL_IDEMPOTENCY,
    WITHDRAWAL_PROVIDER,
    WITHDRAWAL_QUERY,
    WITHDRAWAL_RECOVERY_OPTIONS,
    WITHDRAWAL_REPOSITORY,
  ],
})
export class WithdrawalAdaptersModule {}
