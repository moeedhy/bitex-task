import { Assets, Money } from '@bitex/platform';
import {
  InvalidWithdrawalError,
  InvalidWithdrawalTransitionError,
} from './withdrawal.errors.js';
import { Withdrawal } from './withdrawal.js';

describe('Withdrawal', () => {
  const requestWithdrawal = () =>
    Withdrawal.request({
      id: 'withdrawal-1',
      userId: 'user-123',
      asset: Assets.USDT,
      amount: Money.parse('100', Assets.USDT),
      destinationAddress: 'TXYZ123456789',
      reservationId: 'reservation-1',
      createdAt: new Date('2026-08-15T10:00:00.000Z'),
    });

  it('starts in FUNDS_RESERVED after wallet reservation', () => {
    const withdrawal = requestWithdrawal();

    expect(withdrawal.status).toBe('FUNDS_RESERVED');
    expect(withdrawal.amount.toDecimalString()).toBe('100');
  });

  it('rejects a non-positive amount', () => {
    expect(() =>
      Withdrawal.request({
        id: 'withdrawal-1',
        userId: 'user-123',
        asset: Assets.USDT,
        amount: Money.zero(Assets.USDT),
        destinationAddress: 'TXYZ123456789',
        reservationId: 'reservation-1',
        createdAt: new Date('2026-08-15T10:00:00.000Z'),
      }),
    ).toThrow(InvalidWithdrawalError);
  });

  it('rejects a blank destination address', () => {
    expect(() =>
      Withdrawal.request({
        id: 'withdrawal-1',
        userId: 'user-123',
        asset: Assets.USDT,
        amount: Money.parse('1', Assets.USDT),
        destinationAddress: '   ',
        reservationId: 'reservation-1',
        createdAt: new Date('2026-08-15T10:00:00.000Z'),
      }),
    ).toThrow(InvalidWithdrawalError);
  });

  it('transitions from reserved to processing to completed', () => {
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
    expect(withdrawal.transactionReference).toBeUndefined();
  });

  it('rejects duplicate completion', () => {
    const withdrawal = requestWithdrawal();
    withdrawal.startProcessing();
    withdrawal.complete('provider-tx-1');

    expect(() => withdrawal.complete('provider-tx-1')).toThrow(
      InvalidWithdrawalTransitionError,
    );
  });

  it('rejects duplicate failure', () => {
    const withdrawal = requestWithdrawal();
    withdrawal.startProcessing();
    withdrawal.fail('PROVIDER_ERROR');

    expect(() => withdrawal.fail('PROVIDER_ERROR')).toThrow(
      InvalidWithdrawalTransitionError,
    );
  });

  it('does not allow a completed withdrawal to regress', () => {
    const withdrawal = requestWithdrawal();
    withdrawal.startProcessing();
    withdrawal.complete('provider-tx-1');

    expect(() => withdrawal.startProcessing()).toThrow(
      InvalidWithdrawalTransitionError,
    );
    expect(() => withdrawal.fail('PROVIDER_ERROR')).toThrow(
      InvalidWithdrawalTransitionError,
    );
  });
});
