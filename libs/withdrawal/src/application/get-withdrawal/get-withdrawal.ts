import type { WithdrawalId } from '@bitex/platform';
import { WithdrawalNotFoundError } from '../withdrawal.errors.js';
import type {
  WithdrawalQueryPort,
  WithdrawalView,
} from '../ports/withdrawal-query.port.js';

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
