import { Assets, Money } from '@bitex/platform';
import { WalletAccount } from '../domain/wallet-account.js';
import { WalletReservation } from '../domain/wallet-reservation.js';
import { FinalizeReservation } from './finalize-reservation.js';
import { ReleaseReservation } from './release-reservation.js';
import { ReserveFunds } from './reserve-funds.js';
import type { WalletReservationRepository } from './wallet-reservation.repository.js';
import type { WalletRepository } from './wallet.repository.js';

describe('wallet application services', () => {
  const amount = (value: string) => Money.parse(value, Assets.USDT);

  const createHarness = () => {
    const wallet = WalletAccount.create({
      id: 'wallet-1',
      userId: 'user-123',
      asset: Assets.USDT,
      balance: amount('100'),
    });
    let reservation: WalletReservation | undefined;
    let walletSaves = 0;
    let reservationSaves = 0;
    const wallets: WalletRepository = {
      async getForUpdate() {
        return wallet;
      },
      async getByIdForUpdate() {
        return wallet;
      },
      async save() {
        walletSaves += 1;
      },
    };
    const reservations: WalletReservationRepository = {
      async add(value) {
        reservation = value;
      },
      async getForUpdate() {
        if (!reservation) throw new Error('Reservation was not opened.');
        return reservation;
      },
      async save() {
        reservationSaves += 1;
      },
    };
    const reserveFunds = new ReserveFunds(wallets, reservations, {
      next: () => 'reservation-1',
    });
    return {
      wallet,
      wallets,
      reservations,
      reserveFunds,
      get reservation() {
        return reservation;
      },
      get walletSaves() {
        return walletSaves;
      },
      get reservationSaves() {
        return reservationSaves;
      },
    };
  };

  it('reserves balance and opens an independently persisted reservation', async () => {
    const harness = createHarness();

    const result = await harness.reserveFunds.execute({
      withdrawalId: 'withdrawal-1',
      userId: 'user-123',
      amount: amount('80'),
    });

    expect(result).toEqual({ reservationId: 'reservation-1' });
    expect(harness.wallet.reservedBalance.toDecimalString()).toBe('80');
    expect(harness.reservation?.status).toBe('ACTIVE');
    expect(harness.walletSaves).toBe(1);
  });

  it('finalizes reservation lifecycle and captures reserved balance', async () => {
    const harness = createHarness();
    await harness.reserveFunds.execute({
      withdrawalId: 'withdrawal-1',
      userId: 'user-123',
      amount: amount('80'),
    });

    await new FinalizeReservation(
      harness.wallets,
      harness.reservations,
    ).execute('reservation-1');

    expect(harness.wallet.balance.toDecimalString()).toBe('20');
    expect(harness.reservation?.status).toBe('FINALIZED');
    expect(harness.reservationSaves).toBe(1);
  });

  it('releases reservation lifecycle and reserved balance', async () => {
    const harness = createHarness();
    await harness.reserveFunds.execute({
      withdrawalId: 'withdrawal-1',
      userId: 'user-123',
      amount: amount('80'),
    });

    await new ReleaseReservation(harness.wallets, harness.reservations).execute(
      'reservation-1',
    );

    expect(harness.wallet.availableBalance.toDecimalString()).toBe('100');
    expect(harness.reservation?.status).toBe('RELEASED');
    expect(harness.reservationSaves).toBe(1);
  });
});
