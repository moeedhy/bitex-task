import { Assets, Money } from '@bitex/platform';
import { WalletAccount } from '../domain/wallet-account.js';
import { FinalizeReservation } from './finalize-reservation.js';
import { ReleaseReservation } from './release-reservation.js';
import { ReserveFunds } from './reserve-funds.js';
import type { WalletRepository } from './wallet.repository.js';

describe('wallet application services', () => {
  const createHarness = () => {
    const wallet = WalletAccount.create({
      id: 'wallet-1',
      userId: 'user-123',
      asset: Assets.USDT,
      balance: Money.parse('100', Assets.USDT),
    });
    let saves = 0;
    const repository: WalletRepository = {
      async getForUpdate() {
        return wallet;
      },
      async getByReservationForUpdate() {
        return wallet;
      },
      async save() {
        saves += 1;
      },
    };
    return {
      wallet,
      repository,
      get saves() {
        return saves;
      },
    };
  };

  it('reserves through a locked wallet and persists the aggregate', async () => {
    const harness = createHarness();
    const service = new ReserveFunds(harness.repository, {
      next: () => 'reservation-1',
    });

    const result = await service.execute({
      withdrawalId: 'withdrawal-1',
      userId: 'user-123',
      asset: Assets.USDT,
      amount: Money.parse('80', Assets.USDT),
    });

    expect(result).toEqual({ reservationId: 'reservation-1' });
    expect(harness.wallet.reservedBalance.toDecimalString()).toBe('80');
    expect(harness.saves).toBe(1);
  });

  it('finalizes through the reservation lock path', async () => {
    const harness = createHarness();
    harness.wallet.reserve({
      reservationId: 'reservation-1',
      withdrawalId: 'withdrawal-1',
      amount: Money.parse('80', Assets.USDT),
    });

    await new FinalizeReservation(harness.repository).execute('reservation-1');

    expect(harness.wallet.balance.toDecimalString()).toBe('20');
    expect(harness.saves).toBe(1);
  });

  it('releases through the reservation lock path', async () => {
    const harness = createHarness();
    harness.wallet.reserve({
      reservationId: 'reservation-1',
      withdrawalId: 'withdrawal-1',
      amount: Money.parse('80', Assets.USDT),
    });

    await new ReleaseReservation(harness.repository).execute('reservation-1');

    expect(harness.wallet.availableBalance.toDecimalString()).toBe('100');
    expect(harness.saves).toBe(1);
  });
});
