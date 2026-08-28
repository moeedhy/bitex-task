import { Assets, Money } from '@bitex/platform';
import {
  InvalidReservationAmountError,
  InvalidReservationTransitionError,
  InvalidWalletStateError,
} from './wallet.errors.js';
import { WalletReservation } from './wallet-reservation.js';

describe('WalletReservation', () => {
  const amount = (value: string) => Money.parse(value, Assets.USDT);
  const open = () =>
    WalletReservation.open({
      id: 'reservation-1',
      walletId: 'wallet-1',
      withdrawalId: 'withdrawal-1',
      amount: amount('80'),
    });

  it('opens in ACTIVE state with its aggregate references', () => {
    const reservation = open();

    expect(reservation.status).toBe('ACTIVE');
    expect(reservation.walletId).toBe('wallet-1');
    expect(reservation.withdrawalId).toBe('withdrawal-1');
    expect(reservation.amount.toDecimalString()).toBe('80');
  });

  it.each(['0', '-1'])('rejects reservation amount %s', (value) => {
    expect(() =>
      WalletReservation.open({
        id: 'reservation-1',
        walletId: 'wallet-1',
        withdrawalId: 'withdrawal-1',
        amount: amount(value),
      }),
    ).toThrow(InvalidReservationAmountError);
  });

  it('rejects a blank Withdrawal reference', () => {
    expect(() =>
      WalletReservation.open({
        id: 'reservation-1',
        walletId: 'wallet-1',
        withdrawalId: '   ',
        amount: amount('80'),
      }),
    ).toThrow(InvalidWalletStateError);
  });

  it('finalizes an active reservation', () => {
    const reservation = open();

    reservation.finalize();

    expect(reservation.status).toBe('FINALIZED');
  });

  it('releases an active reservation', () => {
    const reservation = open();

    reservation.release();

    expect(reservation.status).toBe('RELEASED');
  });

  it('keeps finalized reservations terminal', () => {
    const reservation = open();
    reservation.finalize();

    expect(() => reservation.finalize()).toThrow(
      InvalidReservationTransitionError,
    );
    expect(() => reservation.release()).toThrow(
      InvalidReservationTransitionError,
    );
  });

  it('keeps released reservations terminal', () => {
    const reservation = open();
    reservation.release();

    expect(() => reservation.release()).toThrow(
      InvalidReservationTransitionError,
    );
    expect(() => reservation.finalize()).toThrow(
      InvalidReservationTransitionError,
    );
  });

  it('reconstitutes a valid persisted reservation', () => {
    const reservation = WalletReservation.reconstitute({
      id: 'reservation-1',
      walletId: 'wallet-1',
      withdrawalId: 'withdrawal-1',
      amount: amount('80'),
      status: 'ACTIVE',
    });

    reservation.finalize();
    expect(reservation.status).toBe('FINALIZED');
  });

  it('rejects an unknown persisted status', () => {
    expect(() =>
      WalletReservation.reconstitute({
        id: 'reservation-1',
        walletId: 'wallet-1',
        withdrawalId: 'withdrawal-1',
        amount: amount('80'),
        status: 'UNKNOWN' as never,
      }),
    ).toThrow(InvalidWalletStateError);
  });
});
