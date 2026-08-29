import { Module } from '@nestjs/common';
import { uuidV7Generator } from '@bitex/platform';
import { ReserveFunds, SettleReservation } from '@bitex/wallet';
import {
  ExecuteWithdrawal,
  GetWithdrawal,
  RecoverStuckWithdrawals,
  RequestWithdrawal,
} from '@bitex/withdrawal';
import { DatabaseConnection } from '../infrastructure/shared/database-connection.js';
import { PostgresOutbox } from '../infrastructure/shared/postgres-outbox.js';
import { PostgresTransactionRunner } from '../infrastructure/shared/postgres-transaction-runner.js';
import {
  WalletReservationAdapter,
  WalletSettlementAdapter,
} from '../infrastructure/wallet/wallet-capability.adapters.js';
import { PostgresFakeWithdrawalProvider } from '../infrastructure/withdrawal/postgres-fake-withdrawal-provider.js';
import { PostgresProcessedEvents } from '../infrastructure/withdrawal/postgres-processed-events.js';
import { PostgresStuckWithdrawalQuery } from '../infrastructure/withdrawal/postgres-stuck-withdrawal-query.js';
import { PostgresWithdrawalIdempotency } from '../infrastructure/withdrawal/postgres-idempotency.js';
import { PostgresWithdrawalQuery } from '../infrastructure/withdrawal/postgres-withdrawal-query.js';
import { PostgresWithdrawalRepository } from '../infrastructure/withdrawal/postgres-withdrawal-repository.js';
import { envNumber } from './env.js';
import { PersistenceModule } from './persistence.module.js';
import { WalletModule } from './wallet.module.js';

const clock = { now: () => new Date() };

// Two generators, not one object under two names: `IdGenerator` is typed by
// the identity it mints, so handing the withdrawal generator to the event slot
// is now a compile error rather than an invisible coincidence.
const withdrawalIds = uuidV7Generator<'WithdrawalId'>();
const eventIds = uuidV7Generator<'EventId'>();


/**
 * The Withdrawal bounded context. It depends on Wallet only through the two
 * capability adapters, which are the only providers here that touch both
 * modules.
 */
@Module({
  imports: [PersistenceModule, WalletModule],
  providers: [
    {
      provide: PostgresWithdrawalRepository,
      inject: [PostgresTransactionRunner],
      useFactory: (transaction: PostgresTransactionRunner) =>
        new PostgresWithdrawalRepository(transaction),
    },
    {
      provide: PostgresWithdrawalIdempotency,
      inject: [PostgresTransactionRunner],
      useFactory: (transaction: PostgresTransactionRunner) =>
        new PostgresWithdrawalIdempotency(transaction),
    },
    {
      provide: PostgresOutbox,
      inject: [PostgresTransactionRunner],
      useFactory: (transaction: PostgresTransactionRunner) =>
        new PostgresOutbox(transaction),
    },
    {
      provide: PostgresProcessedEvents,
      inject: [PostgresTransactionRunner],
      useFactory: (transaction: PostgresTransactionRunner) =>
        new PostgresProcessedEvents(transaction),
    },
    {
      provide: PostgresStuckWithdrawalQuery,
      inject: [PostgresTransactionRunner],
      useFactory: (transaction: PostgresTransactionRunner) =>
        new PostgresStuckWithdrawalQuery(transaction),
    },
    {
      // Reads bypass the transaction runner: a query that takes no row lock
      // has no reason to join a transaction.
      provide: PostgresWithdrawalQuery,
      inject: [DatabaseConnection],
      useFactory: (database: DatabaseConnection) =>
        new PostgresWithdrawalQuery(database.pool),
    },
    {
      provide: PostgresFakeWithdrawalProvider,
      inject: [DatabaseConnection],
      useFactory: (database: DatabaseConnection) =>
        new PostgresFakeWithdrawalProvider(
          database.pool,
          () => process.env.FAKE_PROVIDER_OUTCOME === 'FAILED',
        ),
    },
    {
      provide: WalletReservationAdapter,
      inject: [ReserveFunds],
      useFactory: (reserveFunds: ReserveFunds) =>
        new WalletReservationAdapter(reserveFunds),
    },
    {
      provide: WalletSettlementAdapter,
      inject: [SettleReservation],
      useFactory: (settle: SettleReservation) =>
        new WalletSettlementAdapter(settle),
    },
    {
      provide: RequestWithdrawal,
      inject: [
        PostgresTransactionRunner,
        PostgresWithdrawalIdempotency,
        WalletReservationAdapter,
        PostgresWithdrawalRepository,
        PostgresOutbox,
      ],
      useFactory: (
        transactionRunner: PostgresTransactionRunner,
        idempotency: PostgresWithdrawalIdempotency,
        walletReservation: WalletReservationAdapter,
        withdrawals: PostgresWithdrawalRepository,
        outbox: PostgresOutbox,
      ) =>
        new RequestWithdrawal({
          transactionRunner,
          idempotency,
          walletReservation,
          withdrawals,
          outbox,
          withdrawalIdGenerator: withdrawalIds,
          eventIdGenerator: eventIds,
          clock,
        }),
    },
    {
      provide: ExecuteWithdrawal,
      inject: [
        PostgresTransactionRunner,
        PostgresWithdrawalRepository,
        PostgresProcessedEvents,
        WalletSettlementAdapter,
        PostgresFakeWithdrawalProvider,
      ],
      useFactory: (
        transactionRunner: PostgresTransactionRunner,
        withdrawals: PostgresWithdrawalRepository,
        processedEvents: PostgresProcessedEvents,
        walletSettlement: WalletSettlementAdapter,
        provider: PostgresFakeWithdrawalProvider,
      ) =>
        new ExecuteWithdrawal({
          transactionRunner,
          withdrawals,
          processedEvents,
          walletSettlement,
          provider,
          clock,
        }),
    },
    {
      provide: RecoverStuckWithdrawals,
      inject: [
        PostgresTransactionRunner,
        PostgresStuckWithdrawalQuery,
        PostgresOutbox,
      ],
      useFactory: (
        transactionRunner: PostgresTransactionRunner,
        stuckWithdrawals: PostgresStuckWithdrawalQuery,
        outbox: PostgresOutbox,
      ) =>
        new RecoverStuckWithdrawals({
          transactionRunner,
          stuckWithdrawals,
          outbox,
          eventIdGenerator: eventIds,
          clock,
          processingTimeoutMs: envNumber(
            process.env.WITHDRAWAL_PROCESSING_TIMEOUT_MS,
            15 * 60 * 1000,
          ),
          batchSize: envNumber(process.env.WITHDRAWAL_RECOVERY_BATCH_SIZE, 50),
        }),
    },
    {
      provide: GetWithdrawal,
      inject: [PostgresWithdrawalQuery],
      useFactory: (query: PostgresWithdrawalQuery) => new GetWithdrawal(query),
    },
  ],
  exports: [
    RequestWithdrawal,
    ExecuteWithdrawal,
    GetWithdrawal,
    RecoverStuckWithdrawals,
  ],
})
export class WithdrawalModule {}
