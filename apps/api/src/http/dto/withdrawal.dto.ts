import { z } from 'zod';
import type {
  RequestWithdrawalResult,
  WithdrawalView,
} from '@bitex/withdrawal';

/**
 * The wire contract, kept separate from the application's own types.
 *
 * The controller previously returned `RequestWithdrawalResult` and
 * `WithdrawalView` verbatim, which made every field of an application result a
 * published API field by default — there was no seam at the driving edge at
 * all, so renaming an internal field was a breaking change to clients and
 * nobody would notice until one broke.
 */

export const CreateWithdrawalSchema = z.strictObject({
  userId: z.string().trim().min(1).max(128),
  asset: z.string().trim().min(1).max(32),
  amount: z.string().trim().min(1).max(128),
  destinationAddress: z.string().trim().min(1).max(256),
});

export type CreateWithdrawalRequest = z.infer<typeof CreateWithdrawalSchema>;

export interface CreateWithdrawalResponse {
  withdrawalId: string;
  status: string;
  asset: string;
  amount: string;
}

export interface WithdrawalResponse {
  withdrawalId: string;
  status: string;
  asset: string;
  amount: string;
  transactionReference?: string;
  createdAt: string;
}

export function toCreateWithdrawalResponse(
  result: RequestWithdrawalResult,
): CreateWithdrawalResponse {
  return {
    withdrawalId: result.withdrawalId,
    status: result.status,
    asset: result.asset,
    amount: result.amount,
  };
}

export function toWithdrawalResponse(view: WithdrawalView): WithdrawalResponse {
  return {
    withdrawalId: view.withdrawalId,
    status: view.status,
    asset: view.asset,
    amount: view.amount,
    // Omitted rather than sent as null while the withdrawal has no outcome.
    ...(view.transactionReference
      ? { transactionReference: view.transactionReference }
      : {}),
    createdAt: view.createdAt,
  };
}
