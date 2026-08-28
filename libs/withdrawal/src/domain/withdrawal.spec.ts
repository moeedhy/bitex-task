import { Assets, Money } from '@bitex/platform';
import { WithdrawalAddress } from './withdrawal-address.js';
import {
  InvalidWithdrawalError,
  InvalidWithdrawalTransitionError,
} from './withdrawal.errors.js';
import { Withdrawal } from './withdrawal.js';

describe('Withdrawal', () => {
  const amount = (value: string) => Money.parse(value, Assets.USDT);
  const requestWithdrawal = () =>
    Withdrawal.request({
      id: 'withdrawal-1',
      userId: 'user-123',
      amount: amount('100'),
      destinationAddress: 'TXYZ123456789',
      reservationId: 'reservation-1',
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
        id: 'withdrawal-1',
        userId: 'user-123',
        amount: amount('0'),
        destinationAddress: 'TXYZ123456789',
        reservationId: 'reservation-1',
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

  it('rejects a blank identity', () => {
    expect(() =>
      Withdrawal.request({
        id: 'withdrawal-1',
        userId: '   ',
        amount: amount('100'),
        destinationAddress: 'TXYZ123456789',
        reservationId: 'reservation-1',
        createdAt: new Date('2026-08-15T10:00:00.000Z'),
      }),
    ).toThrow(InvalidWithdrawalError);
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
      id: 'withdrawal-1',
      userId: 'user-123',
      amount: amount('100'),
      destinationAddress: WithdrawalAddress.reconstitute('TXYZ123456789'),
      reservationId: 'reservation-1',
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
        id: 'withdrawal-1',
        userId: 'user-123',
        amount: amount('100'),
        destinationAddress: WithdrawalAddress.reconstitute('TXYZ123456789'),
        reservationId: 'reservation-1',
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
        id: 'withdrawal-1',
        userId: 'user-123',
        amount: amount('100'),
        destinationAddress: WithdrawalAddress.reconstitute('TXYZ123456789'),
        reservationId: 'reservation-1',
        status: 'FAILED',
        failureReason: 'UNKNOWN' as never,
        createdAt: new Date('2026-08-15T10:00:00.000Z'),
        updatedAt: new Date('2026-08-15T10:01:00.000Z'),
      }),
    ).toThrow(InvalidWithdrawalError);
  });
});
