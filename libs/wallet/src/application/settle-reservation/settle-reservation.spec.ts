import { Assets, Money, ReservationId, UserId, WithdrawalId } from '@bitex/platform';
import { WalletAccount } from '../../domain/wallet-account.js';
import { WalletId } from '../../domain/wallet-id.js';
import { WalletReservation } from '../../domain/wallet-reservation.js';
import { InvalidReservationTransitionError } from '../../domain/wallet.errors.js';
import type { WalletReservationRepository } from '../ports/wallet-reservation.repository.js';
import type { WalletRepository } from '../ports/wallet.repository.js';
import { SettleReservation } from './settle-reservation.js';

const WITHDRAWAL_ID = WithdrawalId.parse('11111111-1111-4111-8111-111111111111');
const USER_ID = UserId.parse('22222222-2222-4222-8222-222222222222');
const WALLET_ID = WalletId.parse('33333333-3333-4333-8333-333333333333');
const RESERVATION_ID = ReservationId.parse('44444444-4444-4444-8444-444444444444');

const amount = (value: string) => Money.parse(value, Assets.USDT);

describe('SettleReservation', () => {
  /**
   * Builds the reserved state directly rather than running `ReserveFunds`
   * first. Settling is a rule of its own, and a unit test of it should fail for
   * its own reasons.
   */
  const createHarness = () => {
    const wallet = WalletAccount.create({
      id: WALLET_ID,
      userId: USER_ID,
      asset: Assets.USDT,
      balance: amount('100'),
    });
    wallet.reserve(amount('80'));
    const reservation = WalletReservation.open({
      id: RESERVATION_ID,
      walletId: WALLET_ID,
      withdrawalId: WITHDRAWAL_ID,
      amount: amount('80'),
    });
    const lockOrder: string[] = [];
    let walletSaves = 0;
    let reservationSaves = 0;

    const wallets: WalletRepository = {
      async getForUpdate() {
        return wallet;
      },
      async getByIdForUpdate() {
        lockOrder.push('wallet');
        return wallet;
      },
      async save() {
        walletSaves += 1;
      },
    };
    const reservations: WalletReservationRepository = {
      async add() {
        return;
      },
      async getForUpdate() {
        lockOrder.push('reservation');
        return reservation;
      },
      async save() {
        reservationSaves += 1;
      },
    };

    return {
      wallet,
      reservation,
      lockOrder,
      useCase: new SettleReservation(wallets, reservations),
      get walletSaves() {
        return walletSaves;
      },
      get reservationSaves() {
        return reservationSaves;
      },
    };
  };

  it('captures the reserved balance when the withdrawal succeeded', async () => {
    const harness = createHarness();

    await harness.useCase.execute({
      reservationId: RESERVATION_ID,
      outcome: 'FINALIZE',
    });

    expect(harness.wallet.balance.toDecimalString()).toBe('20');
    expect(harness.wallet.reservedBalance.toDecimalString()).toBe('0');
    expect(harness.reservation.status).toBe('FINALIZED');
    expect(harness.walletSaves).toBe(1);
    expect(harness.reservationSaves).toBe(1);
  });

  it('returns the funds to available balance when it failed', async () => {
    const harness = createHarness();

    await harness.useCase.execute({
      reservationId: RESERVATION_ID,
      outcome: 'RELEASE',
    });

    // The money never left, so the total is unchanged and all of it is
    // spendable again.
    expect(harness.wallet.balance.toDecimalString()).toBe('100');
    expect(harness.wallet.availableBalance.toDecimalString()).toBe('100');
    expect(harness.reservation.status).toBe('RELEASED');
  });

  /**
   * The deadlock guard. Every path that locks both rows takes them
   * reservation → wallet, which is why two settlements against one wallet
   * cannot wait on each other in opposite orders.
   */
  it('takes the reservation lock before the wallet lock', async () => {
    const harness = createHarness();

    await harness.useCase.execute({
      reservationId: RESERVATION_ID,
      outcome: 'RELEASE',
    });

    expect(harness.lockOrder).toEqual(['reservation', 'wallet']);
  });

  it('refuses to settle a reservation twice', async () => {
    const harness = createHarness();
    await harness.useCase.execute({
      reservationId: RESERVATION_ID,
      outcome: 'FINALIZE',
    });

    await expect(
      harness.useCase.execute({
        reservationId: RESERVATION_ID,
        outcome: 'RELEASE',
      }),
    ).rejects.toThrow(InvalidReservationTransitionError);

    expect(harness.wallet.balance.toDecimalString()).toBe('20');
  });
});
