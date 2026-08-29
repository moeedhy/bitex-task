import { Assets, Money } from '@bitex/platform';
import { PostgresWalletRepository } from './postgres-wallet-repository.js';

describe('PostgresWalletRepository', () => {
  it('loads the wallet with a row lock before exposing it for mutation', async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes('FROM wallets')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'wallet-1',
                user_id: 'user-123',
                asset: 'USDT',
                balance_atomic: '100000000',
                reserved_atomic: '0',
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      },
    };
    const repository = new PostgresWalletRepository({
      client: () => client as never,
    });

    const wallet = await repository.getForUpdate('user-123', Assets.USDT);

    expect(wallet.balance.equals(Money.parse('100', Assets.USDT))).toBe(true);
    expect(queries[0]).toContain('FOR UPDATE');
  });
});
