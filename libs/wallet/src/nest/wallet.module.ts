import { Module } from '@nestjs/common';
import type { DynamicModule, ModuleMetadata } from '@nestjs/common';
import { uuidV7Generator } from '@bitex/platform';
import { provide } from '@bitex/platform/nest';
import { ReserveFunds } from '../application/reserve-funds/reserve-funds.js';
import { SettleReservation } from '../application/settle-reservation/settle-reservation.js';
import {
  RESERVATION_ID_GENERATOR,
  RESERVE_FUNDS,
  SETTLE_RESERVATION,
  WALLET_REPOSITORY,
  WALLET_RESERVATION_REPOSITORY,
} from './wallet.tokens.js';

export interface WalletModuleOptions {
  /**
   * Modules exporting {@link WALLET_REPOSITORY} and
   * {@link WALLET_RESERVATION_REPOSITORY}. The persistence technology is the
   * application's choice, not this context's.
   */
  imports: NonNullable<ModuleMetadata['imports']>;
}

/**
 * The Wallet context wires itself.
 *
 * `@nestjs/common` appears here and nowhere else in this library — the domain
 * and application layers stay framework-free, which is what keeps the brief's
 * "the domain must not depend on the framework" literally true rather than
 * merely intended.
 *
 * It exports only use cases. The repositories stay private, so no other module
 * can reach a wallet aggregate directly: the boundary Withdrawal must respect
 * is enforced at wiring time as well as by the lint rule.
 */
@Module({})
export class WalletModule {
  static forRoot(options: WalletModuleOptions): DynamicModule {
    return {
      module: WalletModule,
      imports: options.imports,
      providers: [
        provide(RESERVATION_ID_GENERATOR, [], () =>
          uuidV7Generator<'ReservationId'>(),
        ),
        provide(
          RESERVE_FUNDS,
          [
            WALLET_REPOSITORY,
            WALLET_RESERVATION_REPOSITORY,
            RESERVATION_ID_GENERATOR,
          ],
          (wallets, reservations, reservationIds) =>
            new ReserveFunds(wallets, reservations, reservationIds),
        ),
        provide(
          SETTLE_RESERVATION,
          [WALLET_REPOSITORY, WALLET_RESERVATION_REPOSITORY],
          (wallets, reservations) =>
            new SettleReservation(wallets, reservations),
        ),
      ],
      exports: [RESERVE_FUNDS, SETTLE_RESERVATION],
    };
  }
}
