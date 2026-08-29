import { CodedError } from '@bitex/platform';
import type { ErrorCodeOf } from '@bitex/platform';

export class InvalidReservationAmountError extends CodedError {
  readonly code = 'INVALID_RESERVATION_AMOUNT' as const;

  constructor() {
    super('Reservation amount must be greater than zero.');
  }
}

export class InvalidWalletAmountError extends CodedError {
  readonly code = 'INVALID_WALLET_AMOUNT' as const;

  constructor() {
    super('Wallet balance operations require a positive amount.');
  }
}

export class WalletAssetMismatchError extends CodedError {
  readonly code = 'WALLET_ASSET_MISMATCH' as const;

  constructor() {
    super('The amount asset does not match the wallet asset.');
  }
}

export class InvalidWalletStateError extends CodedError {
  readonly code = 'INVALID_WALLET_STATE' as const;

  constructor(message: string) {
    super(message);
  }
}

export class InsufficientAvailableBalanceError extends CodedError {
  readonly code = 'INSUFFICIENT_AVAILABLE_BALANCE' as const;

  constructor() {
    super('Wallet has insufficient available balance.');
  }
}

export class InsufficientReservedBalanceError extends CodedError {
  readonly code = 'INSUFFICIENT_RESERVED_BALANCE' as const;

  constructor() {
    super('Wallet has insufficient reserved balance.');
  }
}

export class InvalidReservationTransitionError extends CodedError {
  readonly code = 'INVALID_RESERVATION_TRANSITION' as const;

  constructor(
    readonly reservationId: string,
    readonly currentStatus: string,
    readonly attemptedAction: string,
  ) {
    super(
      `Cannot ${attemptedAction} reservation "${reservationId}" from ${currentStatus}.`,
    );
  }
}

export type WalletDomainErrorCode = ErrorCodeOf<
  | typeof InvalidReservationAmountError
  | typeof InvalidWalletAmountError
  | typeof WalletAssetMismatchError
  | typeof InvalidWalletStateError
  | typeof InsufficientAvailableBalanceError
  | typeof InsufficientReservedBalanceError
  | typeof InvalidReservationTransitionError
>;
