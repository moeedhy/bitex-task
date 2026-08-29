import { Assets, InvalidIdentityError, Money } from '@bitex/platform';
import { WithdrawalAddress } from './withdrawal-address.js';
import {
  InvalidWithdrawalError,
  InvalidWithdrawalTransitionError,
} from './withdrawal.errors.js';
import { Withdrawal } from './withdrawal.js';
import { ReservationId, UserId, WithdrawalId } from '@bitex/platform';

// Fixed identities. Parsed rather than cast, so the fixtures are
// exactly what the production edges accept.
const WITHDRAWAL_ID = WithdrawalId.parse('11111111-1111-4111-8111-111111111111');
const USER_ID = UserId.parse('22222222-2222-4222-8222-222222222222');
const RESERVATION_ID = ReservationId.parse('44444444-4444-4444-8444-444444444444');

describe('Withdrawal', () => {
  const amount = (value: string) => Money.parse(value, Assets.USDT);
  const requestWithdrawal = () =>
    Withdrawal.request({
      id: WITHDRAWAL_ID,
      userId: USER_ID,
      amount: amount('100'),
      destinationAddress: 'TXYZ123456789',
      reservationId: RESERVATION_ID,
      createdAt: new Date('2026-08-15T10:00:00.000Z'),
    });

  it('starts in PENDING after funds are reserved', () => {
    const withdrawal = requestWithdrawal();

    expect(withdrawal.status).toBe('PENDING');
    expect(withdrawal.amount.toDecimalString()).toBe('100');
    expect(withdrawal.destinationAddress.value).toBe('TXYZ123456789');
  });

  it('rejects a non-positive amount', () => {
    expect(() =>
      Withdrawal.request({
        id: WITHDRAWAL_ID,
        userId: USER_ID,
        amount: amount('0'),
        destinationAddress: 'TXYZ123456789',
        reservationId: RESERVATION_ID,
        createdAt: new Date('2026-08-15T10:00:00.000Z'),
      }),
    ).toThrow(InvalidWithdrawalError);
  });

  it('transitions from pending to processing to completed', () => {
    const withdrawal = requestWithdrawal();

    withdrawal.startProcessing();
    withdrawal.complete('provider-tx-1');

    expect(withdrawal.status).toBe('COMPLETED');
    expect(withdrawal.transactionReference).toBe('provider-tx-1');
  });

  it('transitions from processing to failed', () => {
    const withdrawal = requestWithdrawal();

    withdrawal.startProcessing();
    withdrawal.fail('PROVIDER_ERROR');

    expect(withdrawal.status).toBe('FAILED');
    expect(withdrawal.failureReason).toBe('PROVIDER_ERROR');
  });

  it('rejects failure before processing begins', () => {
    expect(() => requestWithdrawal().fail('PROVIDER_ERROR')).toThrow(
      InvalidWithdrawalTransitionError,
    );
  });

  /**
   * The aggregate stopped re-checking identities it cannot be handed unparsed.
   * The assertion moved to the parser, which is both stricter than the old
   * non-blank check and applied once, at the edge.
   */
  it('cannot be given an identity that was never parsed', () => {
    expect(() => UserId.parse('   ')).toThrow(InvalidIdentityError);
    expect(() => UserId.parse('user-123')).toThrow(InvalidIdentityError);
  });

  it('rejects completion before processing', () => {
    expect(() => requestWithdrawal().complete('provider-tx-1')).toThrow(
      InvalidWithdrawalTransitionError,
    );
  });

  it('does not complete when the provider transaction reference is blank', () => {
    const withdrawal = requestWithdrawal();
    withdrawal.startProcessing();

    expect(() => withdrawal.complete('   ')).toThrow(InvalidWithdrawalError);
    expect(withdrawal.status).toBe('PROCESSING');
  });

  it('keeps completed withdrawals terminal', () => {
    const withdrawal = requestWithdrawal();
    withdrawal.startProcessing();
    withdrawal.complete('provider-tx-1');

    expect(() => withdrawal.complete('provider-tx-1')).toThrow(
      InvalidWithdrawalTransitionError,
    );
    expect(() => withdrawal.startProcessing()).toThrow(
      InvalidWithdrawalTransitionError,
    );
    expect(() => withdrawal.fail('PROVIDER_ERROR')).toThrow(
      InvalidWithdrawalTransitionError,
    );
  });

  it('keeps failed withdrawals terminal', () => {
    const withdrawal = requestWithdrawal();
    withdrawal.startProcessing();
    withdrawal.fail('PROVIDER_ERROR');

    expect(() => withdrawal.fail('PROVIDER_ERROR')).toThrow(
      InvalidWithdrawalTransitionError,
    );
    expect(() => withdrawal.complete('provider-tx-1')).toThrow(
      InvalidWithdrawalTransitionError,
    );
  });

  it('reconstitutes valid persisted state', () => {
    const withdrawal = Withdrawal.reconstitute({
      id: WITHDRAWAL_ID,
      userId: USER_ID,
      amount: amount('100'),
      destinationAddress: WithdrawalAddress.reconstitute('TXYZ123456789'),
      reservationId: RESERVATION_ID,
      status: 'PROCESSING',
      createdAt: new Date('2026-08-15T10:00:00.000Z'),
      updatedAt: new Date('2026-08-15T10:01:00.000Z'),
    });

    withdrawal.complete('provider-tx-1');
    expect(withdrawal.status).toBe('COMPLETED');
  });

  it('rejects inconsistent persisted terminal state', () => {
    expect(() =>
      Withdrawal.reconstitute({
        id: WITHDRAWAL_ID,
        userId: USER_ID,
        amount: amount('100'),
        destinationAddress: WithdrawalAddress.reconstitute('TXYZ123456789'),
        reservationId: RESERVATION_ID,
        status: 'COMPLETED',
        failureReason: 'PROVIDER_ERROR',
        createdAt: new Date('2026-08-15T10:00:00.000Z'),
        updatedAt: new Date('2026-08-15T10:01:00.000Z'),
      }),
    ).toThrow(InvalidWithdrawalError);
  });

  it('rejects an unknown persisted failure reason', () => {
    expect(() =>
      Withdrawal.reconstitute({
        id: WITHDRAWAL_ID,
        userId: USER_ID,
        amount: amount('100'),
        destinationAddress: WithdrawalAddress.reconstitute('TXYZ123456789'),
        reservationId: RESERVATION_ID,
        status: 'FAILED',
        failureReason: 'UNKNOWN' as never,
        createdAt: new Date('2026-08-15T10:00:00.000Z'),
        updatedAt: new Date('2026-08-15T10:01:00.000Z'),
      }),
    ).toThrow(InvalidWithdrawalError);
  });
});
