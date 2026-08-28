/**
 * Workflow-level failures raised while coordinating aggregates, ports, and the
 * provider. They are not domain rules and carry no transport concerns.
 */
export class WithdrawalNotFoundError extends Error {
  readonly code = 'WITHDRAWAL_NOT_FOUND' as const;

  constructor(readonly withdrawalId: string) {
    super(`Withdrawal "${withdrawalId}" was not found.`);
    this.name = 'WithdrawalNotFoundError';
  }
}

/**
 * The provider call neither succeeded nor returned a rejection, so the transfer
 * may or may not have happened. The Withdrawal deliberately stays PROCESSING
 * and the reservation stays ACTIVE; redelivery re-drives the idempotent
 * provider rather than releasing funds that may already be gone.
 */
export class WithdrawalExecutionUnresolvedError extends Error {
  readonly code = 'WITHDRAWAL_EXECUTION_UNRESOLVED' as const;

  constructor(
    readonly withdrawalId: string,
    options: { cause: unknown },
  ) {
    super(
      `Provider execution for withdrawal "${withdrawalId}" did not resolve; the withdrawal remains PROCESSING.`,
      options,
    );
    this.name = 'WithdrawalExecutionUnresolvedError';
  }
}
