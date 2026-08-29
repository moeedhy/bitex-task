import type { WithdrawalId } from '@bitex/platform';
import type { WithdrawalStatus } from '../../domain/withdrawal-status.js';
import { WithdrawalNotFoundError } from '../withdrawal.errors.js';

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

export class GetWithdrawal {
  constructor(private readonly query: WithdrawalQueryPort) {}

  async execute(id: WithdrawalId): Promise<WithdrawalView> {
    const view = await this.query.getById(id);
    if (!view) {
      throw new WithdrawalNotFoundError(id);
    }
    return view;
  }
}
