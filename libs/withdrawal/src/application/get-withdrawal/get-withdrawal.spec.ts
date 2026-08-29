import { WithdrawalNotFoundError } from '../withdrawal.errors.js';
import { GetWithdrawal } from './get-withdrawal.js';
import { WithdrawalId } from '@bitex/platform';

// Fixed identities. Parsed rather than cast, so the fixtures are
// exactly what the production edges accept.
const WITHDRAWAL_ID = WithdrawalId.parse('11111111-1111-4111-8111-111111111111');
const MISSING_WITHDRAWAL_ID = WithdrawalId.parse(
  '11111111-1111-4111-8111-1111111110ff',
);

describe('GetWithdrawal', () => {
  const view = {
    withdrawalId: WITHDRAWAL_ID,
    status: 'COMPLETED' as const,
    asset: 'USDT',
    amount: '100',
    transactionReference: 'tx-1',
    createdAt: '2026-08-15T10:00:00.000Z',
  };

  it('returns the slice-specific read model', async () => {
    const query = new GetWithdrawal({ getById: async () => view });

    await expect(query.execute(WITHDRAWAL_ID)).resolves.toEqual(view);
  });

  it('rejects an unknown withdrawal', async () => {
    const query = new GetWithdrawal({ getById: async () => null });

    await expect(query.execute(MISSING_WITHDRAWAL_ID)).rejects.toThrow(
      WithdrawalNotFoundError,
    );
  });
});
