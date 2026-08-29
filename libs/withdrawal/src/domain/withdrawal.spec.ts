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

// The aggregate takes `now` rather than defaulting to `new Date()`: an ambient
// clock inside the domain makes time untestable and hides a dependency.
const CREATED_AT = new Date('2026-08-15T10:00:00.000Z');
const NOW = new Date('2026-08-15T10:05:00.000Z');

describe('Withdrawal', () => {
  const amount = (value: string) => Money.parse(value, Assets.USDT);
  const requestWithdrawal = () =>
    Withdrawal.request({
      id: WITHDRAWAL_ID,
      userId: USER_ID,
      amount: amount('100'),
      destinationAddress: 'TXYZ123456789',
      reservationId: RESERVATION_ID,
      createdAt: CREATED_AT,
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
        createdAt: CREATED_AT,
      }),
    ).toThrow(InvalidWithdrawalError);
  });

  it('transitions from pending to processing to completed', () => {
    const withdrawal = requestWithdrawal();

    withdrawal.startProcessing(NOW);
    withdrawal.complete('provider-tx-1', NOW);

    expect(withdrawal.status).toBe('COMPLETED');
    expect(withdrawal.transactionReference).toBe('provider-tx-1');
  });

  it('transitions from processing to failed', () => {
    const withdrawal = requestWithdrawal();

    withdrawal.startProcessing(NOW);
    withdrawal.fail('PROVIDER_ERROR', NOW);

    expect(withdrawal.status).toBe('FAILED');
    expect(withdrawal.failureReason).toBe('PROVIDER_ERROR');
  });

  it('rejects failure before processing begins', () => {
    expect(() => requestWithdrawal().fail('PROVIDER_ERROR', NOW)).toThrow(
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
    expect(() => requestWithdrawal().complete('provider-tx-1', NOW)).toThrow(
      InvalidWithdrawalTransitionError,
    );
  });

  it('does not complete when the provider transaction reference is blank', () => {
    const withdrawal = requestWithdrawal();
    withdrawal.startProcessing(NOW);

    expect(() => withdrawal.complete('   ', NOW)).toThrow(InvalidWithdrawalError);
    expect(withdrawal.status).toBe('PROCESSING');
  });

  it('keeps completed withdrawals terminal', () => {
    const withdrawal = requestWithdrawal();
    withdrawal.startProcessing(NOW);
    withdrawal.complete('provider-tx-1', NOW);

    expect(() => withdrawal.complete('provider-tx-1', NOW)).toThrow(
      InvalidWithdrawalTransitionError,
    );
    expect(() => withdrawal.startProcessing(NOW)).toThrow(
      InvalidWithdrawalTransitionError,
    );
    expect(() => withdrawal.fail('PROVIDER_ERROR', NOW)).toThrow(
      InvalidWithdrawalTransitionError,
    );
  });

  it('keeps failed withdrawals terminal', () => {
    const withdrawal = requestWithdrawal();
    withdrawal.startProcessing(NOW);
    withdrawal.fail('PROVIDER_ERROR', NOW);

    expect(() => withdrawal.fail('PROVIDER_ERROR', NOW)).toThrow(
      InvalidWithdrawalTransitionError,
    );
    expect(() => withdrawal.complete('provider-tx-1', NOW)).toThrow(
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
      createdAt: CREATED_AT,
      updatedAt: new Date('2026-08-15T10:01:00.000Z'),
    });

    withdrawal.complete('provider-tx-1', NOW);
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
        createdAt: CREATED_AT,
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
        createdAt: CREATED_AT,
        updatedAt: new Date('2026-08-15T10:01:00.000Z'),
      }),
    ).toThrow(InvalidWithdrawalError);
  });

  describe('domain events', () => {
    it('announces the execution intent when requested', () => {
      const [event, ...rest] = requestWithdrawal().pullDomainEvents();

      expect(rest).toHaveLength(0);
      expect(event).toEqual({
        type: 'WithdrawalExecutionRequested',
        withdrawalId: WITHDRAWAL_ID,
        userId: USER_ID,
        asset: Assets.USDT,
        amount: amount('100'),
        occurredAt: CREATED_AT,
      });
    });

    /**
     * Invariant 5.8 of the brief. The reservation travels *with* the failure,
     * so releasing it is not something a caller has to remember: the aggregate
     * states the obligation, and ExecuteWithdrawal's handler is exhaustive over
     * this union.
     */
    it('names the reservation it stranded when it fails', () => {
      const withdrawal = requestWithdrawal();
      withdrawal.startProcessing(NOW);
      withdrawal.pullDomainEvents();

      withdrawal.fail('PROVIDER_ERROR', NOW);

      expect(withdrawal.pullDomainEvents()).toEqual([
        {
          type: 'WithdrawalFailed',
          withdrawalId: WITHDRAWAL_ID,
          reservationId: RESERVATION_ID,
          reason: 'PROVIDER_ERROR',
          occurredAt: NOW,
        },
      ]);
    });

    it('names the reservation it must capture when it completes', () => {
      const withdrawal = requestWithdrawal();
      withdrawal.startProcessing(NOW);
      withdrawal.pullDomainEvents();

      withdrawal.complete('provider-tx-1', NOW);

      expect(withdrawal.pullDomainEvents()).toEqual([
        {
          type: 'WithdrawalCompleted',
          withdrawalId: WITHDRAWAL_ID,
          reservationId: RESERVATION_ID,
          transactionReference: 'provider-tx-1',
          occurredAt: NOW,
        },
      ]);
    });

    it('announces nothing for a transition that obliges no one', () => {
      const withdrawal = requestWithdrawal();
      withdrawal.pullDomainEvents();

      withdrawal.startProcessing(NOW);

      expect(withdrawal.pullDomainEvents()).toEqual([]);
    });

    /**
     * Draining, not reading. The caller acts on each event once, inside the
     * transaction that persists the change producing it; a second drain in the
     * same transaction must not settle the reservation twice.
     */
    it('forgets what it has already handed over', () => {
      const withdrawal = requestWithdrawal();

      expect(withdrawal.pullDomainEvents()).toHaveLength(1);
      expect(withdrawal.pullDomainEvents()).toHaveLength(0);
    });

    it('emits nothing when rebuilt from storage', () => {
      const rebuilt = Withdrawal.reconstitute(requestWithdrawal().toSnapshot());

      expect(rebuilt.pullDomainEvents()).toEqual([]);
    });
  });

  describe('terminality', () => {
    it.each([
      ['PENDING', (w: Withdrawal) => w],
      ['PROCESSING', (w: Withdrawal) => (w.startProcessing(NOW), w)],
    ])('is not terminal while %s', (_label, advance) => {
      expect(advance(requestWithdrawal()).isTerminal()).toBe(false);
    });

    it.each([
      ['COMPLETED', (w: Withdrawal) => w.complete('provider-tx-1', NOW)],
      ['FAILED', (w: Withdrawal) => w.fail('PROVIDER_ERROR', NOW)],
    ])('is terminal once %s', (_label, finish) => {
      const withdrawal = requestWithdrawal();
      withdrawal.startProcessing(NOW);

      finish(withdrawal);

      expect(withdrawal.isTerminal()).toBe(true);
    });
  });

  describe('state changes are all-or-nothing', () => {
    /**
     * The aggregate used to mutate in place, so a rejected `complete` left the
     * status advanced with no reference behind it. Building the candidate state
     * first and swapping only once it validates makes a rejection a no-op.
     */
    it('leaves the withdrawal untouched when a transition is rejected', () => {
      const withdrawal = requestWithdrawal();
      withdrawal.startProcessing(NOW);
      withdrawal.pullDomainEvents();

      expect(() => withdrawal.complete('   ', NOW)).toThrow(
        InvalidWithdrawalError,
      );

      expect(withdrawal.status).toBe('PROCESSING');
      expect(withdrawal.transactionReference).toBeUndefined();
      expect(withdrawal.pullDomainEvents()).toEqual([]);
    });

    it('rejects a stored status it does not recognise', () => {
      const snapshot = requestWithdrawal().toSnapshot();

      expect(() =>
        Withdrawal.reconstitute({
          ...snapshot,
          status: 'ABANDONED' as never,
        }),
      ).toThrow(InvalidWithdrawalError);
    });
  });
});
