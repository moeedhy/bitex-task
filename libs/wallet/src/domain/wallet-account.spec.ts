import { Assets, Money } from '@bitex/platform';
import {
  DuplicateWithdrawalReservationError,
  InsufficientAvailableBalanceError,
  InvalidReservationAmountError,
  InvalidWalletStateError,
  ReservationStateError,
} from './wallet.errors.js';
import { WalletAccount } from './wallet-account.js';

describe('WalletAccount', () => {
  const amount = (value: string) => Money.parse(value, Assets.USDT);
  const createWallet = () =>
    WalletAccount.create({
      id: 'wallet-1',
      userId: 'user-123',
      asset: Assets.USDT,
      balance: amount('100'),
    });

  it('rejects a negative opening balance', () => {
    expect(() =>
      WalletAccount.create({
        id: 'wallet-1',
        userId: 'user-123',
        asset: Assets.USDT,
        balance: amount('-1'),
      }),
    ).toThrow(InvalidWalletStateError);
  });

  it('rejects persisted reserved balance above total balance', () => {
    expect(() =>
      WalletAccount.restore({
        id: 'wallet-1',
        userId: 'user-123',
        asset: Assets.USDT,
        balance: amount('100'),
        reservedBalance: amount('101'),
        reservations: [],
      }),
    ).toThrow(InvalidWalletStateError);
  });

  it.each(['0', '-1'])('rejects reservation amount %s', (value) => {
    const wallet = createWallet();

    expect(() =>
      wallet.reserve({
        reservationId: 'reservation-1',
        withdrawalId: 'withdrawal-1',
        amount: amount(value),
      }),
    ).toThrow(InvalidReservationAmountError);
  });

  it('reserves funds and derives available balance', () => {
    const wallet = createWallet();

    const reservation = wallet.reserve({
      reservationId: 'reservation-1',
      withdrawalId: 'withdrawal-1',
      amount: amount('80'),
    });

    expect(reservation.status).toBe('ACTIVE');
    expect(wallet.reservedBalance.toDecimalString()).toBe('80');
    expect(wallet.availableBalance.toDecimalString()).toBe('20');
  });

  it('rejects a reservation larger than available balance', () => {
    const wallet = createWallet();

    expect(() =>
      wallet.reserve({
        reservationId: 'reservation-1',
        withdrawalId: 'withdrawal-1',
        amount: amount('101'),
      }),
    ).toThrow(InsufficientAvailableBalanceError);
  });

  it('prevents duplicate reservation for the same withdrawal', () => {
    const wallet = createWallet();
    wallet.reserve({
      reservationId: 'reservation-1',
      withdrawalId: 'withdrawal-1',
      amount: amount('10'),
    });

    expect(() =>
      wallet.reserve({
        reservationId: 'reservation-2',
        withdrawalId: 'withdrawal-1',
        amount: amount('10'),
      }),
    ).toThrow(DuplicateWithdrawalReservationError);
  });

  it('releases an active reservation without debiting total balance', () => {
    const wallet = createWallet();
    wallet.reserve({
      reservationId: 'reservation-1',
      withdrawalId: 'withdrawal-1',
      amount: amount('80'),
    });

    wallet.releaseReservation('reservation-1');

    expect(wallet.balance.toDecimalString()).toBe('100');
    expect(wallet.reservedBalance.toDecimalString()).toBe('0');
    expect(wallet.availableBalance.toDecimalString()).toBe('100');
    expect(wallet.getReservation('reservation-1').status).toBe('RELEASED');
  });

  it('finalizes an active reservation exactly once', () => {
    const wallet = createWallet();
    wallet.reserve({
      reservationId: 'reservation-1',
      withdrawalId: 'withdrawal-1',
      amount: amount('80'),
    });

    wallet.finalizeReservation('reservation-1');

    expect(wallet.balance.toDecimalString()).toBe('20');
    expect(wallet.reservedBalance.toDecimalString()).toBe('0');
    expect(wallet.availableBalance.toDecimalString()).toBe('20');
    expect(wallet.getReservation('reservation-1').status).toBe('FINALIZED');
  });

  it('rejects finalization twice', () => {
    const wallet = createWallet();
    wallet.reserve({
      reservationId: 'reservation-1',
      withdrawalId: 'withdrawal-1',
      amount: amount('10'),
    });
    wallet.finalizeReservation('reservation-1');

    expect(() => wallet.finalizeReservation('reservation-1')).toThrow(
      ReservationStateError,
    );
  });

  it('rejects release after finalization', () => {
    const wallet = createWallet();
    wallet.reserve({
      reservationId: 'reservation-1',
      withdrawalId: 'withdrawal-1',
      amount: amount('10'),
    });
    wallet.finalizeReservation('reservation-1');

    expect(() => wallet.releaseReservation('reservation-1')).toThrow(
      ReservationStateError,
    );
  });

  it('rejects finalization after release', () => {
    const wallet = createWallet();
    wallet.reserve({
      reservationId: 'reservation-1',
      withdrawalId: 'withdrawal-1',
      amount: amount('10'),
    });
    wallet.releaseReservation('reservation-1');

    expect(() => wallet.finalizeReservation('reservation-1')).toThrow(
      ReservationStateError,
    );
  });

  it('restores persisted active reservations without replaying commands', () => {
    const wallet = WalletAccount.restore({
      id: 'wallet-1',
      userId: 'user-123',
      asset: Assets.USDT,
      balance: amount('100'),
      reservedBalance: amount('80'),
      reservations: [
        {
          id: 'reservation-1',
          withdrawalId: 'withdrawal-1',
          amount: amount('80'),
          status: 'ACTIVE',
        },
      ],
    });

    wallet.finalizeReservation('reservation-1');

    expect(wallet.balance.toDecimalString()).toBe('20');
    expect(wallet.toSnapshot().reservations).toEqual([
      expect.objectContaining({ id: 'reservation-1', status: 'FINALIZED' }),
    ]);
  });
});
