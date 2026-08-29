import { Assets, InvalidIdentityError, Money } from '@bitex/platform';
import {
  InvalidReservationAmountError,
  InvalidReservationTransitionError,
  InvalidWalletStateError,
} from './wallet.errors.js';
import { WalletReservation } from './wallet-reservation.js';
import { ReservationId, WithdrawalId } from '@bitex/platform';
import { WalletId } from './wallet-id.js';

// Fixed identities. Parsed rather than cast, so the fixtures are
// exactly what the production edges accept.
const WITHDRAWAL_ID = WithdrawalId.parse('11111111-1111-4111-8111-111111111111');
const WALLET_ID = WalletId.parse('33333333-3333-4333-8333-333333333333');
const RESERVATION_ID = ReservationId.parse('44444444-4444-4444-8444-444444444444');

describe('WalletReservation', () => {
  const amount = (value: string) => Money.parse(value, Assets.USDT);
  const open = () =>
    WalletReservation.open({
      id: RESERVATION_ID,
      walletId: WALLET_ID,
      withdrawalId: WITHDRAWAL_ID,
      amount: amount('80'),
    });

  it('opens in ACTIVE state with its aggregate references', () => {
    const reservation = open();

    expect(reservation.status).toBe('ACTIVE');
    expect(reservation.walletId).toBe(WALLET_ID);
    expect(reservation.withdrawalId).toBe(WITHDRAWAL_ID);
    expect(reservation.amount.toDecimalString()).toBe('80');
  });

  it.each(['0', '-1'])('rejects reservation amount %s', (value) => {
    expect(() =>
      WalletReservation.open({
        id: RESERVATION_ID,
        walletId: WALLET_ID,
        withdrawalId: WITHDRAWAL_ID,
        amount: amount(value),
      }),
    ).toThrow(InvalidReservationAmountError);
  });

  /** See the equivalent note in wallet-account.spec.ts. */
  it('cannot be given a Withdrawal reference that was never parsed', () => {
    expect(() => WithdrawalId.parse('   ')).toThrow(InvalidIdentityError);
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
      id: RESERVATION_ID,
      walletId: WALLET_ID,
      withdrawalId: WITHDRAWAL_ID,
      amount: amount('80'),
      status: 'ACTIVE',
    });

    reservation.finalize();
    expect(reservation.status).toBe('FINALIZED');
  });

  it('rejects an unknown persisted status', () => {
    expect(() =>
      WalletReservation.reconstitute({
        id: RESERVATION_ID,
        walletId: WALLET_ID,
        withdrawalId: WITHDRAWAL_ID,
        amount: amount('80'),
        status: 'UNKNOWN' as never,
      }),
    ).toThrow(InvalidWalletStateError);
  });
});
