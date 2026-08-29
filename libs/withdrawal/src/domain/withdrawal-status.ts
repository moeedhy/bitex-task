/**
 * The status vocabulary, declared once as a value so that the type and the
 * runtime guard cannot drift apart.
 *
 * Previously the union was written by hand and the guard was a separate array
 * literal inside `assertState`; adding a status meant remembering both, and
 * forgetting the second let an unknown status from the database through.
 */
export const WITHDRAWAL_STATUSES = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
] as const;

export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

/**
 * The statuses after which no further transition is legal.
 *
 * Named here rather than compared inline, because `status === 'COMPLETED' ||
 * status === 'FAILED'` appeared twice in the application layer -- the
 * definition of terminality, expressed outside the aggregate that owns it.
 * Missing one of those two comparisons re-settles a finished withdrawal.
 */
export const TERMINAL_WITHDRAWAL_STATUSES = ['COMPLETED', 'FAILED'] as const;

export type TerminalWithdrawalStatus =
  (typeof TERMINAL_WITHDRAWAL_STATUSES)[number];

export const WITHDRAWAL_FAILURE_REASONS = ['PROVIDER_ERROR'] as const;

export type WithdrawalFailureReason =
  (typeof WITHDRAWAL_FAILURE_REASONS)[number];

export function isWithdrawalStatus(value: unknown): value is WithdrawalStatus {
  return (WITHDRAWAL_STATUSES as readonly unknown[]).includes(value);
}

export function isWithdrawalFailureReason(
  value: unknown,
): value is WithdrawalFailureReason {
  return (WITHDRAWAL_FAILURE_REASONS as readonly unknown[]).includes(value);
}

export function isTerminalWithdrawalStatus(
  status: WithdrawalStatus,
): status is TerminalWithdrawalStatus {
  return (TERMINAL_WITHDRAWAL_STATUSES as readonly WithdrawalStatus[]).includes(
    status,
  );
}
