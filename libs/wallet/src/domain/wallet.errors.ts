export class InvalidReservationAmountError extends Error {
  readonly code = 'INVALID_RESERVATION_AMOUNT' as const;

  constructor() {
    super('Reservation amount must be greater than zero.');
    this.name = 'InvalidReservationAmountError';
  }
}

export class InvalidWalletAmountError extends Error {
  readonly code = 'INVALID_WALLET_AMOUNT' as const;

  constructor() {
    super('Wallet balance operations require a positive amount.');
    this.name = 'InvalidWalletAmountError';
  }
}

export class WalletAssetMismatchError extends Error {
  readonly code = 'WALLET_ASSET_MISMATCH' as const;

  constructor() {
    super('The amount asset does not match the wallet asset.');
    this.name = 'WalletAssetMismatchError';
  }
}

export class InvalidWalletStateError extends Error {
  readonly code = 'INVALID_WALLET_STATE' as const;

  constructor(message: string) {
    super(message);
    this.name = 'InvalidWalletStateError';
  }
}

export class InsufficientAvailableBalanceError extends Error {
  readonly code = 'INSUFFICIENT_AVAILABLE_BALANCE' as const;

  constructor() {
    super('Wallet has insufficient available balance.');
    this.name = 'InsufficientAvailableBalanceError';
  }
}

export class InsufficientReservedBalanceError extends Error {
  readonly code = 'INSUFFICIENT_RESERVED_BALANCE' as const;

  constructor() {
    super('Wallet has insufficient reserved balance.');
    this.name = 'InsufficientReservedBalanceError';
  }
}

export class InvalidReservationTransitionError extends Error {
  readonly code = 'INVALID_RESERVATION_TRANSITION' as const;

  constructor(
    readonly reservationId: string,
    readonly currentStatus: string,
    readonly attemptedAction: string,
  ) {
    super(
      `Cannot ${attemptedAction} reservation "${reservationId}" from ${currentStatus}.`,
    );
    this.name = 'InvalidReservationTransitionError';
  }
}
