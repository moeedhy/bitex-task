import { token } from '@bitex/platform/nest';
import type { IdGenerator } from '@bitex/platform';
import type { WalletRepository } from '../application/ports/wallet.repository.js';
import type { WalletReservationRepository } from '../application/ports/wallet-reservation.repository.js';
import type { ReserveFunds } from '../application/reserve-funds/reserve-funds.js';
import type { SettleReservation } from '../application/settle-reservation/settle-reservation.js';

/** Bound by the application. */
export const WALLET_REPOSITORY = token<WalletRepository>('WalletRepository');
export const WALLET_RESERVATION_REPOSITORY = token<WalletReservationRepository>(
  'WalletReservationRepository',
);

/** Owned by this module: reservation ids are this context's to mint. */
export const RESERVATION_ID_GENERATOR =
  token<IdGenerator<'ReservationId'>>('ReservationIdGenerator');

/** Exported to whoever imports this module. */
export const RESERVE_FUNDS = token<ReserveFunds>('ReserveFunds');
export const SETTLE_RESERVATION = token<SettleReservation>('SettleReservation');