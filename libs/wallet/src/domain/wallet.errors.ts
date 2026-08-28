export class InvalidReservationAmountError extends Error {
  readonly code = 'INVALID_RESERVATION_AMOUNT' as const;

  constructor() {
    super('Reservation amount must be greater than zero.');
    this.name = 'InvalidReservationAmountError';
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

export class DuplicateWithdrawalReservationError extends Error {
  readonly code = 'DUPLICATE_WITHDRAWAL_RESERVATION' as const;

  constructor(readonly withdrawalId: string) {
    super(`Withdrawal "${withdrawalId}" already has a reservation.`);
    this.name = 'DuplicateWithdrawalReservationError';
  }
}

export class ReservationNotFoundError extends Error {
  readonly code = 'RESERVATION_NOT_FOUND' as const;

  constructor(readonly reservationId: string) {
    super(`Reservation "${reservationId}" was not found.`);
    this.name = 'ReservationNotFoundError';
  }
}

export class ReservationStateError extends Error {
  readonly code = 'INVALID_RESERVATION_STATE' as const;

  constructor(
    readonly reservationId: string,
    readonly currentStatus: string,
    readonly attemptedAction: string,
  ) {
    super(
      `Cannot ${attemptedAction} reservation "${reservationId}" from ${currentStatus}.`,
    );
    this.name = 'ReservationStateError';
  }
}
