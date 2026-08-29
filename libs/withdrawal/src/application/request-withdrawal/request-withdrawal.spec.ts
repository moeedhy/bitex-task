import { Assets, Money } from '@bitex/platform';
import { IdempotencyKeyConflictError } from '../withdrawal.errors.js';
import { RequestWithdrawal } from './request-withdrawal.js';
import type {
  IdempotencyClaim,
  RequestWithdrawalDependencies,
  RequestWithdrawalResult,
} from './request-withdrawal.js';
import { EventId, ReservationId, UserId, WithdrawalId } from '@bitex/platform';

// Fixed identities. Parsed rather than cast, so the fixtures are
// exactly what the production edges accept.
const WITHDRAWAL_ID = WithdrawalId.parse('11111111-1111-4111-8111-111111111111');
const ORIGINAL_WITHDRAWAL_ID = WithdrawalId.parse('11111111-1111-4111-8111-1111111110aa');
const USER_ID = UserId.parse('22222222-2222-4222-8222-222222222222');
const RESERVATION_ID = ReservationId.parse('44444444-4444-4444-8444-444444444444');
const EVENT_ID = EventId.parse('55555555-5555-4555-8555-555555555555');

/**
 * Stands in for any wallet-side domain rejection. The withdrawal slice must not
 * import the wallet module, so the test asserts on propagation, not identity.
 */
class WalletRejection extends Error {
  readonly code = 'INSUFFICIENT_AVAILABLE_BALANCE' as const;
}

describe('RequestWithdrawal', () => {
  const command = {
    idempotencyKey: 'key-123',
    userId: USER_ID,
    amount: Money.parse('100', Assets.USDT),
    destinationAddress: 'TXYZ123456789',
  };

  const createHarness = () => {
    const withdrawals: unknown[] = [];
    const events: unknown[] = [];
    const completions: RequestWithdrawalResult[] = [];
    const claimedFingerprints: string[] = [];
    let reserveCalls = 0;
    let transactionCalls = 0;
    let claim: IdempotencyClaim = { kind: 'CLAIMED' };
    let reserveFailure: Error | undefined;

    const dependencies: RequestWithdrawalDependencies = {
      transactionRunner: {
        async run<T>(operation: () => Promise<T>): Promise<T> {
          transactionCalls += 1;
          return operation();
        },
      },
      idempotency: {
        async claim(input) {
          claimedFingerprints.push(input.fingerprint);
          return claim;
        },
        async complete(_key, result) {
          completions.push(result);
        },
      },
      walletReservation: {
        async reserve() {
          reserveCalls += 1;
          if (reserveFailure) {
            throw reserveFailure;
          }
          return { reservationId: RESERVATION_ID };
        },
      },
      withdrawals: {
        async add(withdrawal) {
          withdrawals.push(withdrawal);
        },
        async getForUpdate() {
          throw new Error('not used');
        },
        async save() {
          return;
        },
      },
      outbox: {
        async append(event) {
          events.push(event);
        },
      },
      withdrawalIdGenerator: { next: () => WITHDRAWAL_ID },
      eventIdGenerator: { next: () => EVENT_ID },
      clock: { now: () => new Date('2026-08-15T10:00:00.000Z') },
    };

    return {
      useCase: new RequestWithdrawal(dependencies),
      withdrawals,
      events,
      completions,
      claimedFingerprints,
      get reserveCalls() {
        return reserveCalls;
      },
      get transactionCalls() {
        return transactionCalls;
      },
      setClaim(next: IdempotencyClaim) {
        claim = next;
      },
      failReservation(error: Error) {
        reserveFailure = error;
      },
    };
  };

  it('atomically reserves funds, creates the withdrawal and appends its event', async () => {
    const harness = createHarness();

    const result = await harness.useCase.execute(command);

    expect(result).toEqual({
      withdrawalId: WITHDRAWAL_ID,
      status: 'PENDING',
      asset: 'USDT',
      amount: '100',
    });
    expect(harness.transactionCalls).toBe(1);
    expect(harness.reserveCalls).toBe(1);
    expect(harness.withdrawals).toHaveLength(1);
    expect(harness.events).toEqual([
      expect.objectContaining({
        id: EVENT_ID,
        type: 'WithdrawalExecutionRequested',
        aggregateId: WITHDRAWAL_ID,
      }),
    ]);
    expect(harness.completions).toEqual([result]);
  });

  it('derives the fingerprint from the command instead of trusting the caller', async () => {
    const harness = createHarness();

    await harness.useCase.execute(command);
    await harness.useCase.execute({
      ...command,
      amount: Money.parse('100.000000', Assets.USDT),
      destinationAddress: '  TXYZ123456789  ',
    });

    expect(harness.claimedFingerprints).toHaveLength(2);
    expect(harness.claimedFingerprints[0]).toBeTruthy();
    expect(harness.claimedFingerprints[0]).toBe(harness.claimedFingerprints[1]);
  });

  it('returns the stored response without repeating financial effects', async () => {
    const harness = createHarness();
    const original: RequestWithdrawalResult = {
      withdrawalId: ORIGINAL_WITHDRAWAL_ID,
      status: 'PENDING',
      asset: 'USDT',
      amount: '100',
    };
    harness.setClaim({ kind: 'REPLAY', result: original });

    const result = await harness.useCase.execute(command);

    expect(result).toEqual(original);
    expect(harness.reserveCalls).toBe(0);
    expect(harness.withdrawals).toHaveLength(0);
    expect(harness.events).toHaveLength(0);
    expect(harness.completions).toHaveLength(0);
  });

  it('rejects a key reused with a different payload without reserving funds', async () => {
    const harness = createHarness();
    harness.setClaim({ kind: 'CONFLICT' });

    await expect(harness.useCase.execute(command)).rejects.toThrow(
      IdempotencyKeyConflictError,
    );
    expect(harness.reserveCalls).toBe(0);
    expect(harness.withdrawals).toHaveLength(0);
    expect(harness.events).toHaveLength(0);
    expect(harness.completions).toHaveLength(0);
  });

  it('propagates a wallet domain rejection without persisting anything', async () => {
    const harness = createHarness();
    harness.failReservation(
      new WalletRejection('insufficient available balance'),
    );

    await expect(harness.useCase.execute(command)).rejects.toThrow(
      WalletRejection,
    );
    expect(harness.withdrawals).toHaveLength(0);
    expect(harness.events).toHaveLength(0);
    expect(harness.completions).toHaveLength(0);
  });
});
