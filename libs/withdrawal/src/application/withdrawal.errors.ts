import { CodedError } from '@bitex/platform';
import type { ErrorCodeOf } from '@bitex/platform';

/**
 * Workflow-level failures raised while coordinating aggregates, ports, and the
 * provider. They are not domain rules and carry no transport concerns.
 */
export class WithdrawalNotFoundError extends CodedError {
  readonly code = 'WITHDRAWAL_NOT_FOUND' as const;

  constructor(readonly withdrawalId: string) {
    super(`Withdrawal "${withdrawalId}" was not found.`);
  }
}

/**
 * The Idempotency-Key was already used for a request with different semantic
 * content. Replaying it would return a result describing a different
 * withdrawal, so the workflow refuses instead.
 *
 * The contract lives here rather than in a persistence adapter: which storage
 * detects the collision is an implementation choice, but the fact that a
 * collision rejects the request is application behaviour.
 */
export class IdempotencyKeyConflictError extends CodedError {
  readonly code = 'IDEMPOTENCY_CONFLICT' as const;

  constructor(readonly idempotencyKey: string) {
    super(
      `Idempotency-Key "${idempotencyKey}" was already used with a different request payload.`,
    );
  }
}

/**
 * The provider call neither succeeded nor returned a rejection, so the transfer
 * may or may not have happened. The Withdrawal deliberately stays PROCESSING
 * and the reservation stays ACTIVE; redelivery re-drives the idempotent
 * provider rather than releasing funds that may already be gone.
 */
export class WithdrawalExecutionUnresolvedError extends CodedError {
  readonly code = 'WITHDRAWAL_EXECUTION_UNRESOLVED' as const;

  /**
   * The only retryable failure this workflow raises. Every other one is a
   * rejected rule or a missing row, which the next attempt would reject
   * identically; this one means "we do not know yet", and the provider call is
   * idempotent, so asking again is exactly the right move.
   */
  override readonly retryable = true;

  constructor(
    readonly withdrawalId: string,
    options: { cause: unknown },
  ) {
    super(
      `Provider execution for withdrawal "${withdrawalId}" did not resolve; the withdrawal remains PROCESSING.`,
      options,
    );
  }
}

export type WithdrawalApplicationErrorCode = ErrorCodeOf<
  | typeof WithdrawalNotFoundError
  | typeof IdempotencyKeyConflictError
  | typeof WithdrawalExecutionUnresolvedError
>;
