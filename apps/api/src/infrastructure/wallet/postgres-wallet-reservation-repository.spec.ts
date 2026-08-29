import { PostgresWalletReservationRepository } from './postgres-wallet-reservation-repository.js';
import { ReservationId, WithdrawalId } from '@bitex/platform';
import { WalletId } from '@bitex/wallet';

// Fixed identities. Parsed rather than cast, so the fixtures are
// exactly what the production edges accept.
const WITHDRAWAL_ID = WithdrawalId.parse('11111111-1111-4111-8111-111111111111');
const WALLET_ID = WalletId.parse('33333333-3333-4333-8333-333333333333');
const RESERVATION_ID = ReservationId.parse('44444444-4444-4444-8444-444444444444');

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
              id: RESERVATION_ID,
              wallet_id: WALLET_ID,
              withdrawal_id: WITHDRAWAL_ID,
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

    const reservation = await repository.getForUpdate(RESERVATION_ID);

    expect(reservation.walletId).toBe(WALLET_ID);
    expect(reservation.amount.toDecimalString()).toBe('80');
    expect(queries[0]).toContain('FOR UPDATE');
  });
});
