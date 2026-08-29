import { CodedError } from '@bitex/platform';
import type { ErrorCodeOf } from '@bitex/platform';

/**
 * Lookup failures are application/persistence outcomes rather than domain
 * rules, so they live with the ports that raise them.
 */
export class WalletNotFoundError extends CodedError {
  readonly code = 'WALLET_NOT_FOUND' as const;

  constructor(readonly walletRef: string) {
    super(`Wallet "${walletRef}" was not found.`);
  }
}

export class ReservationNotFoundError extends CodedError {
  readonly code = 'RESERVATION_NOT_FOUND' as const;

  constructor(readonly reservationId: string) {
    super(`Reservation "${reservationId}" was not found.`);
  }
}

export type WalletApplicationErrorCode = ErrorCodeOf<
  typeof WalletNotFoundError | typeof ReservationNotFoundError
>;
