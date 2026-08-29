import { Module } from '@nestjs/common';
import { provide } from '@bitex/platform/nest';
import {
  WALLET_REPOSITORY,
  WALLET_RESERVATION_REPOSITORY,
} from '@bitex/wallet/nest';
import { PostgresWalletRepository } from '../adapters/wallet/postgres-wallet-repository.js';
import { PostgresWalletReservationRepository } from '../adapters/wallet/postgres-wallet-reservation-repository.js';
import {
  PersistenceModule,
  TRANSACTIONAL_CLIENT,
} from './persistence.module.js';

/**
 * Binds the Wallet context's ports to PostgreSQL. Nothing else: the use cases
 * and the id generator are the library's own business.
 *
 * `TRANSACTION_RUNNER` is injected as the neutral interface rather than as
 * `PostgresTransactionRunner`. The repositories previously took
 * `TransactionalClient` — a dependency on the shape of a
 * concrete class, which is the dependency inversion the ports exist to avoid.
 */
@Module({
  imports: [PersistenceModule],
  providers: [
    provide(
      WALLET_REPOSITORY,
      [TRANSACTIONAL_CLIENT],
      (transaction) => new PostgresWalletRepository(transaction),
    ),
    provide(
      WALLET_RESERVATION_REPOSITORY,
      [TRANSACTIONAL_CLIENT],
      (transaction) => new PostgresWalletReservationRepository(transaction),
    ),
  ],
  exports: [WALLET_REPOSITORY, WALLET_RESERVATION_REPOSITORY],
})
export class WalletAdaptersModule {}
