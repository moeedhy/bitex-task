import type { WithdrawalId } from '@bitex/platform';
import type { WithdrawalStatus } from '../../domain/withdrawal-status.js';

/**
 * The read model. A projection of the aggregate shaped for reading, served
 * without a row lock and without rebuilding domain objects.
 */
export interface WithdrawalView {
  withdrawalId: WithdrawalId;
  status: WithdrawalStatus;
  asset: string;
  amount: string;
  transactionReference?: string;
  createdAt: string;
}

export interface WithdrawalQueryPort {
  getById(id: WithdrawalId): Promise<WithdrawalView | null>;
}
