import { PostgresFakeWithdrawalProvider } from './postgres-fake-withdrawal-provider.js';
import { WithdrawalId } from '@bitex/platform';

// Fixed identities. Parsed rather than cast, so the fixtures are
// exactly what the production edges accept.
const WITHDRAWAL_ID = WithdrawalId.parse('11111111-1111-4111-8111-111111111111');

describe('PostgresFakeWithdrawalProvider', () => {
  it('returns the same provider result for repeated withdrawal execution', async () => {
    let stored: unknown;
    const pool = {
      async query(sql: string, values: unknown[]) {
        if (sql.includes('INSERT INTO fake_provider_executions')) {
          if (stored) return { rowCount: 0, rows: [] };
          stored = JSON.parse(values[1] as string);
          return { rowCount: 1, rows: [{ result: stored }] };
        }
        return { rowCount: 1, rows: [{ result: stored }] };
      },
    };
    const provider = new PostgresFakeWithdrawalProvider(
      pool as never,
      () => false,
      () => 'tx-fixed',
    );
    const request = {
      withdrawalId: WITHDRAWAL_ID,
      amount: '100',
      asset: 'USDT',
      destinationAddress: 'TXYZ123456789',
    };

    const first = await provider.execute(request);
    const retry = await provider.execute(request);

    expect(first).toEqual({
      status: 'SUCCESS',
      transactionReference: 'tx-fixed',
    });
    expect(retry).toEqual(first);
  });
});
