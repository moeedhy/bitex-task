import type { WithdrawalId } from '@bitex/platform';

export type ExecutionRequest = Readonly<{
  withdrawalId: WithdrawalId;
  asset: string;
  amount: string;
  destinationAddress: string;
}>;

/**
 * A discriminated union rather than optional fields, so "succeeded without a
 * reference" and "failed with a reference" cannot be represented.
 *
 * Both members are *declared* provider outcomes. A thrown error is neither: it
 * means the call did not resolve, and `ExecuteWithdrawal` treats that as
 * uncertainty rather than as failure.
 */
export type ExecutionResult =
  | Readonly<{ status: 'SUCCESS'; transactionReference: string }>
  | Readonly<{ status: 'FAILED'; reason: 'PROVIDER_ERROR' }>;

export interface WithdrawalProvider {
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}
