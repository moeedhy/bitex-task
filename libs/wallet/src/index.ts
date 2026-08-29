/**
 * The Wallet context's public surface.
 *
 * Explicit named exports, never `export *`. A star export publishes whatever a
 * file happens to declare, which is how both repository interfaces, every
 * `*Snapshot` and every dependency bag became part of this module's contract
 * without anyone deciding they should be.
 */

// The aggregates, and the identity type that addresses one of them. Consumers
// outside this library reconstitute wallets only through the repositories, so
// the classes are exported for the adapters that implement those ports.
export { WalletAccount } from './domain/wallet-account.js';
export type { WalletAccountSnapshot } from './domain/wallet-account.js';
export { WalletReservation } from './domain/wallet-reservation.js';
export type { WalletReservationSnapshot } from './domain/wallet-reservation.js';
export {
  isWalletReservationStatus,
  WALLET_RESERVATION_STATUSES,
} from './domain/wallet-reservation.js';
export type { WalletReservationStatus } from './domain/wallet-reservation.js';
export { WalletId } from './domain/wallet-id.js';

export {
  InsufficientAvailableBalanceError,
  InsufficientReservedBalanceError,
  InvalidReservationAmountError,
  InvalidReservationTransitionError,
  InvalidWalletAmountError,
  InvalidWalletStateError,
  WalletAssetMismatchError,
} from './domain/wallet.errors.js';
export type { WalletDomainErrorCode } from './domain/wallet.errors.js';
export {
  ReservationNotFoundError,
  WalletNotFoundError,
} from './application/wallet.errors.js';
export type { WalletApplicationErrorCode } from './application/wallet.errors.js';

// Ports, for the composition root to satisfy.
export type { WalletRepository } from './application/ports/wallet.repository.js';
export type { WalletReservationRepository } from './application/ports/wallet-reservation.repository.js';

// Use cases.
export { ReserveFunds } from './application/reserve-funds/reserve-funds.js';
export type {
  ReserveFundsCommand,
  ReserveFundsResult,
} from './application/reserve-funds/reserve-funds.contract.js';
export { SettleReservation } from './application/settle-reservation/settle-reservation.js';
export { RESERVATION_OUTCOMES } from './application/settle-reservation/settle-reservation.contract.js';
export type {
  ReservationOutcome,
  SettleReservationCommand,
} from './application/settle-reservation/settle-reservation.contract.js';
