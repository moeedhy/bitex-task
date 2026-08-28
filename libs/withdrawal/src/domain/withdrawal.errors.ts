export class InvalidWithdrawalError extends Error {
  readonly code = 'INVALID_WITHDRAWAL' as const;

  constructor(message: string) {
    super(message);
    this.name = 'InvalidWithdrawalError';
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

export class WithdrawalNotFoundError extends Error {
  readonly code = 'WITHDRAWAL_NOT_FOUND' as const;

  constructor(readonly withdrawalId: string) {
    super(`Withdrawal "${withdrawalId}" was not found.`);
    this.name = 'WithdrawalNotFoundError';
  }
}
