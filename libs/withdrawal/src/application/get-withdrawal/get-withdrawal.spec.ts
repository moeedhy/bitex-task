import { WithdrawalNotFoundError } from '../../domain/withdrawal.errors.js';
import { GetWithdrawal } from './get-withdrawal.js';

describe('GetWithdrawal', () => {
  const view = {
    withdrawalId: 'withdrawal-1',
    status: 'COMPLETED' as const,
    asset: 'USDT',
    amount: '100',
    transactionReference: 'tx-1',
    createdAt: '2026-08-15T10:00:00.000Z',
  };

  it('returns the slice-specific read model', async () => {
    const query = new GetWithdrawal({ getById: async () => view });

    await expect(query.execute('withdrawal-1')).resolves.toEqual(view);
  });

  it('rejects an unknown withdrawal', async () => {
    const query = new GetWithdrawal({ getById: async () => null });

    await expect(query.execute('missing')).rejects.toThrow(
      WithdrawalNotFoundError,
    );
  });
});
