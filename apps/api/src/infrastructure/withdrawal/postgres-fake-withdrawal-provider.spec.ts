import { PostgresFakeWithdrawalProvider } from './postgres-fake-withdrawal-provider.js';

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
      withdrawalId: 'withdrawal-1',
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
