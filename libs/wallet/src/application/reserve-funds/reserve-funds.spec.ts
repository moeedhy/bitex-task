import { Assets, Money, ReservationId, UserId, WithdrawalId } from '@bitex/platform';
import { WalletAccount } from '../../domain/wallet-account.js';
import { WalletId } from '../../domain/wallet-id.js';
import type { WalletReservation } from '../../domain/wallet-reservation.js';
import type { WalletReservationRepository } from '../ports/wallet-reservation.repository.js';
import type { WalletRepository } from '../ports/wallet.repository.js';
import { ReserveFunds } from './reserve-funds.js';

const WITHDRAWAL_ID = WithdrawalId.parse('11111111-1111-4111-8111-111111111111');
const USER_ID = UserId.parse('22222222-2222-4222-8222-222222222222');
const WALLET_ID = WalletId.parse('33333333-3333-4333-8333-333333333333');
const RESERVATION_ID = ReservationId.parse('44444444-4444-4444-8444-444444444444');

const amount = (value: string) => Money.parse(value, Assets.USDT);

describe('ReserveFunds', () => {
  const createHarness = () => {
    const wallet = WalletAccount.create({
      id: WALLET_ID,
      userId: USER_ID,
      asset: Assets.USDT,
      balance: amount('100'),
    });
    let reservation: WalletReservation | undefined;
    let walletSaves = 0;

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
        return;
      },
    };

    return {
      wallet,
      useCase: new ReserveFunds(wallets, reservations, {
        next: () => RESERVATION_ID,
      }),
      get reservation() {
        return reservation;
      },
      get walletSaves() {
        return walletSaves;
      },
    };
  };

  it('reserves balance and opens an independently persisted reservation', async () => {
    const harness = createHarness();

    const result = await harness.useCase.execute({
      withdrawalId: WITHDRAWAL_ID,
      userId: USER_ID,
      amount: amount('80'),
    });

    expect(result).toEqual({ reservationId: RESERVATION_ID });
    expect(harness.wallet.reservedBalance.toDecimalString()).toBe('80');
    expect(harness.wallet.availableBalance.toDecimalString()).toBe('20');
    expect(harness.reservation?.status).toBe('ACTIVE');
    expect(harness.walletSaves).toBe(1);
  });

  /**
   * The reservation links back to the withdrawal that caused it, which is what
   * lets the composite foreign key in migration 002 prove the two agree.
   */
  it('links the reservation to the withdrawal that caused it', async () => {
    const harness = createHarness();

    await harness.useCase.execute({
      withdrawalId: WITHDRAWAL_ID,
      userId: USER_ID,
      amount: amount('80'),
    });

    expect(harness.reservation?.withdrawalId).toBe(WITHDRAWAL_ID);
    expect(harness.reservation?.walletId).toBe(WALLET_ID);
  });

  it('does not persist anything when the wallet refuses the amount', async () => {
    const harness = createHarness();

    await expect(
      harness.useCase.execute({
        withdrawalId: WITHDRAWAL_ID,
        userId: USER_ID,
        amount: amount('101'),
      }),
    ).rejects.toThrow();

    expect(harness.reservation).toBeUndefined();
    expect(harness.walletSaves).toBe(0);
  });
});
