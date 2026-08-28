import { PostgresWalletReservationRepository } from './postgres-wallet-reservation-repository.js';

describe('PostgresWalletReservationRepository', () => {
  it('loads an independent reservation aggregate with a row lock', async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        return {
          rowCount: 1,
          rows: [
            {
              id: 'reservation-1',
              wallet_id: 'wallet-1',
              withdrawal_id: 'withdrawal-1',
              asset: 'USDT',
              amount_atomic: '80000000',
              status: 'ACTIVE',
            },
          ],
        };
      },
    };
    const repository = new PostgresWalletReservationRepository({
      client: () => client as never,
    });

    const reservation = await repository.getForUpdate('reservation-1');

    expect(reservation.walletId).toBe('wallet-1');
    expect(reservation.amount.toDecimalString()).toBe('80');
    expect(queries[0]).toContain('FOR UPDATE');
  });
});
