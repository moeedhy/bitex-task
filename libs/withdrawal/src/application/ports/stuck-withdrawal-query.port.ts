import type { UserId, WithdrawalId } from '@bitex/platform';

/**
 * The immutable facts needed to re-drive execution. Deliberately a read model
 * rather than the aggregate: recovery re-publishes an intent, it does not
 * mutate the Withdrawal.
 */
export interface StuckWithdrawal {
  withdrawalId: WithdrawalId;
  userId: UserId;
  asset: string;
  amount: string;
}

export interface StuckWithdrawalQueryPort {
  findProcessingSince(input: {
    threshold: Date;
    limit: number;
  }): Promise<StuckWithdrawal[]>;
}
