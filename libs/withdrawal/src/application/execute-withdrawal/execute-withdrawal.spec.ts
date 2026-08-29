import { Assets, Money } from '@bitex/platform';
import { Withdrawal } from '../../domain/withdrawal.js';
import { WithdrawalExecutionUnresolvedError } from '../withdrawal.errors.js';
import { ExecuteWithdrawal } from './execute-withdrawal.js';
import type { ExecuteWithdrawalDependencies } from './execute-withdrawal.js';
import { EventId, ReservationId, UserId, WithdrawalId } from '@bitex/platform';

// Fixed identities. Parsed rather than cast, so the fixtures are
// exactly what the production edges accept.
const WITHDRAWAL_ID = WithdrawalId.parse('11111111-1111-4111-8111-111111111111');
const USER_ID = UserId.parse('22222222-2222-4222-8222-222222222222');
const RESERVATION_ID = ReservationId.parse('44444444-4444-4444-8444-444444444444');
const EVENT_ID = EventId.parse('55555555-5555-4555-8555-555555555555');

describe('ExecuteWithdrawal', () => {
  const createHarness = (
    providerStatus: 'SUCCESS' | 'FAILED' | 'THROWS' = 'SUCCESS',
  ) => {
    const withdrawal = Withdrawal.request({
      id: WITHDRAWAL_ID,
      userId: USER_ID,
      amount: Money.parse('100', Assets.USDT),
      destinationAddress: 'TXYZ123456789',
      reservationId: RESERVATION_ID,
      createdAt: new Date('2026-08-15T10:00:00.000Z'),
    });
    const processed = new Set<string>();
    let providerCalls = 0;
    // The reservation ids are recorded, not just the call counts: the
    // settlement target now comes from the aggregate's own event rather than
    // from a field the caller reads, so a test that only counted calls would
    // pass even if the wrong reservation were released.
    const finalized: ReservationId[] = [];
    const released: ReservationId[] = [];
    let transactionCalls = 0;

    const dependencies: ExecuteWithdrawalDependencies = {
      transactionRunner: {
        async run<T>(operation: () => Promise<T>): Promise<T> {
          transactionCalls += 1;
          return operation();
        },
      },
      withdrawals: {
        async getForUpdate() {
          return withdrawal;
        },
        async save() {
          return;
        },
      },
      processedEvents: {
        async has(eventId) {
          return processed.has(eventId);
        },
        async record(eventId) {
          processed.add(eventId);
        },
      },
      walletSettlement: {
        async finalize(reservationId) {
          finalized.push(reservationId);
        },
        async release(reservationId) {
          released.push(reservationId);
        },
      },
      provider: {
        async execute() {
          providerCalls += 1;
          if (providerStatus === 'THROWS') {
            throw new Error('socket hang up');
          }
          return providerStatus === 'SUCCESS'
            ? { status: 'SUCCESS' as const, transactionReference: 'tx-1' }
            : { status: 'FAILED' as const, reason: 'PROVIDER_ERROR' as const };
        },
      },
      clock: { now: () => new Date('2026-08-15T10:01:00.000Z') },
    };

    return {
      useCase: new ExecuteWithdrawal(dependencies),
      withdrawal,
      processed,
      get providerCalls() {
        return providerCalls;
      },
      finalized,
      released,
      get finalizeCalls() {
        return finalized.length;
      },
      get releaseCalls() {
        return released.length;
      },
      get transactionCalls() {
        return transactionCalls;
      },
    };
  };

  it('completes and finalizes a successful provider execution', async () => {
    const harness = createHarness('SUCCESS');

    await harness.useCase.execute({
      eventId: EVENT_ID,
      withdrawalId: WITHDRAWAL_ID,
    });

    expect(harness.withdrawal.status).toBe('COMPLETED');
    expect(harness.withdrawal.transactionReference).toBe('tx-1');
    expect(harness.finalized).toEqual([RESERVATION_ID]);
    expect(harness.released).toEqual([]);
    expect(harness.processed.has(EVENT_ID)).toBe(true);
    expect(harness.transactionCalls).toBe(2);
  });

  it('fails and releases a failed provider execution', async () => {
    const harness = createHarness('FAILED');

    await harness.useCase.execute({
      eventId: EVENT_ID,
      withdrawalId: WITHDRAWAL_ID,
    });

    expect(harness.withdrawal.status).toBe('FAILED');
    expect(harness.finalized).toEqual([]);
    // Invariant 5.8: the funds the failed withdrawal reserved go back. The
    // reservation named here is the one the aggregate emitted, not one the use
    // case looked up afterwards.
    expect(harness.released).toEqual([RESERVATION_ID]);
    expect(harness.processed.has(EVENT_ID)).toBe(true);
  });

  it('leaves an unresolved provider call PROCESSING instead of failing it', async () => {
    const harness = createHarness('THROWS');

    await expect(
      harness.useCase.execute({
        eventId: EVENT_ID,
        withdrawalId: WITHDRAWAL_ID,
      }),
    ).rejects.toThrow(WithdrawalExecutionUnresolvedError);

    expect(harness.withdrawal.status).toBe('PROCESSING');
    expect(harness.finalizeCalls).toBe(0);
    expect(harness.releaseCalls).toBe(0);
    expect(harness.processed.has(EVENT_ID)).toBe(false);
  });

  it('does not call the provider or settle a processed event twice', async () => {
    const harness = createHarness('SUCCESS');
    harness.processed.add(EVENT_ID);

    await harness.useCase.execute({
      eventId: EVENT_ID,
      withdrawalId: WITHDRAWAL_ID,
    });

    expect(harness.providerCalls).toBe(0);
    expect(harness.finalizeCalls).toBe(0);
    expect(harness.releaseCalls).toBe(0);
    expect(harness.transactionCalls).toBe(1);
  });
});
