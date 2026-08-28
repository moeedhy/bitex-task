export class InvalidWithdrawalError extends Error {
  readonly code = 'INVALID_WITHDRAWAL' as const;

  constructor(message: string) {
    super(message);
    this.name = 'InvalidWithdrawalError';
  }
}

export class InvalidWithdrawalAddressError extends Error {
  readonly code = 'INVALID_WITHDRAWAL_ADDRESS' as const;

  constructor(message = 'Withdrawal destination address is invalid.') {
    super(message);
    this.name = 'InvalidWithdrawalAddressError';
  }
}

export class InvalidWithdrawalTransitionError extends Error {
  readonly code = 'INVALID_WITHDRAWAL_TRANSITION' as const;

  constructor(
    readonly currentStatus: string,
    readonly targetStatus: string,
  ) {
    super(
      `Cannot transition withdrawal from ${currentStatus} to ${targetStatus}.`,
    );
    this.name = 'InvalidWithdrawalTransitionError';
  }
}
