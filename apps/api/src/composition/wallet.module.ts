import { Module } from '@nestjs/common';
import { uuidV7Generator } from '@bitex/platform';
import { ReserveFunds, SettleReservation } from '@bitex/wallet';
import { PostgresWalletRepository } from '../infrastructure/wallet/postgres-wallet-repository.js';
import { PostgresWalletReservationRepository } from '../infrastructure/wallet/postgres-wallet-reservation-repository.js';
import { PostgresTransactionRunner } from '../infrastructure/shared/postgres-transaction-runner.js';
import { PersistenceModule } from './persistence.module.js';

/**
 * The Wallet bounded context: its aggregates' repositories and the two use
 * cases built on them.
 *
 * It exports only use cases. Repositories stay private, so no other module can
 * reach a wallet aggregate directly — the boundary Withdrawal must respect is
 * enforced here at wiring time as well as by the lint rule.
 */
@Module({
  imports: [PersistenceModule],
  providers: [
    {
      provide: PostgresWalletRepository,
      inject: [PostgresTransactionRunner],
      useFactory: (transaction: PostgresTransactionRunner) =>
        new PostgresWalletRepository(transaction),
    },
    {
      provide: PostgresWalletReservationRepository,
      inject: [PostgresTransactionRunner],
      useFactory: (transaction: PostgresTransactionRunner) =>
        new PostgresWalletReservationRepository(transaction),
    },
    {
      provide: ReserveFunds,
      inject: [PostgresWalletRepository, PostgresWalletReservationRepository],
      useFactory: (
        wallets: PostgresWalletRepository,
        reservations: PostgresWalletReservationRepository,
      ) =>
        new ReserveFunds(
          wallets,
          reservations,
          uuidV7Generator<'ReservationId'>(),
        ),
    },
    {
      provide: SettleReservation,
      inject: [PostgresWalletRepository, PostgresWalletReservationRepository],
      useFactory: (
        wallets: PostgresWalletRepository,
        reservations: PostgresWalletReservationRepository,
      ) => new SettleReservation(wallets, reservations),
    },
  ],
  exports: [ReserveFunds, SettleReservation],
})
export class WalletModule {}
