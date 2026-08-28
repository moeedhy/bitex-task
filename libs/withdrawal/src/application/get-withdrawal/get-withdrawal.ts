import type { WithdrawalStatus } from '../../domain/withdrawal.js';
import { WithdrawalNotFoundError } from '../withdrawal.errors.js';

export interface WithdrawalView {
  withdrawalId: string;
  status: WithdrawalStatus;
  asset: string;
  amount: string;
  transactionReference?: string;
  createdAt: string;
}

export interface WithdrawalQueryPort {
  getById(id: string): Promise<WithdrawalView | null>;
}

export class GetWithdrawal {
  constructor(private readonly query: WithdrawalQueryPort) {}

  async execute(id: string): Promise<WithdrawalView> {
    const view = await this.query.getById(id);
    if (!view) {
      throw new WithdrawalNotFoundError(id);
    }
    return view;
  }
}
