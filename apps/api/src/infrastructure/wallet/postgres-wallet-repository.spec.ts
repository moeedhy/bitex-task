import { Assets, Money } from '@bitex/platform';
import { PostgresWalletRepository } from './postgres-wallet-repository.js';
import { UserId } from '@bitex/platform';
import { WalletId } from '@bitex/wallet';

// Fixed identities. Parsed rather than cast, so the fixtures are
// exactly what the production edges accept.
const USER_ID = UserId.parse('22222222-2222-4222-8222-222222222222');
const WALLET_ID = WalletId.parse('33333333-3333-4333-8333-333333333333');

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
                id: WALLET_ID,
                user_id: USER_ID,
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

    const wallet = await repository.getForUpdate(USER_ID, Assets.USDT);

    expect(wallet.balance.equals(Money.parse('100', Assets.USDT))).toBe(true);
    expect(queries[0]).toContain('FOR UPDATE');
  });
});
