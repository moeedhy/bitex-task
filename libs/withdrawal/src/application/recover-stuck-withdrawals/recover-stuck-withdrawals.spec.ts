import type { AnyIntegrationEvent } from '@bitex/platform';
import { RecoverStuckWithdrawals } from './recover-stuck-withdrawals.js';
import type { RecoverStuckWithdrawalsDependencies } from './recover-stuck-withdrawals.js';
import type { StuckWithdrawal } from '../ports/stuck-withdrawal-query.port.js';
import { EventId, UserId, WithdrawalId } from '@bitex/platform';

// Fixed identities. Parsed rather than cast, so the fixtures are
// exactly what the production edges accept.
const WITHDRAWAL_ID = WithdrawalId.parse('11111111-1111-4111-8111-111111111111');
const OTHER_WITHDRAWAL_ID = WithdrawalId.parse('11111111-1111-4111-8111-111111111112');
const USER_ID = UserId.parse('22222222-2222-4222-8222-222222222222');
// The harness mints sequential event ids so the assertions can name them.
const recoveryEventId = (nth: number) =>
  EventId.parse(`55555555-5555-4555-8555-${String(nth).padStart(12, '0')}`);

describe('RecoverStuckWithdrawals', () => {
  const stuckWithdrawal: StuckWithdrawal = {
    withdrawalId: WITHDRAWAL_ID,
    userId: USER_ID,
    asset: 'USDT',
    amount: '100',
  };

  const createHarness = (stuck: StuckWithdrawal[]) => {
    const events: AnyIntegrationEvent[] = [];
    const thresholds: Date[] = [];
    let transactionCalls = 0;
    let eventIds = 0;

    const dependencies: RecoverStuckWithdrawalsDependencies = {
      transactionRunner: {
        async run<T>(operation: () => Promise<T>): Promise<T> {
          transactionCalls += 1;
          return operation();
        },
      },
      stuckWithdrawals: {
        async findProcessingSince(input) {
          thresholds.push(input.threshold);
          return stuck;
        },
      },
      outbox: {
        async append(event) {
          events.push(event);
        },
      },
      eventIdGenerator: {
        next: () => recoveryEventId(++eventIds),
      },
      clock: { now: () => new Date('2026-08-15T10:30:00.000Z') },
      processingTimeoutMs: 15 * 60 * 1000,
      batchSize: 50,
    };

    return {
      useCase: new RecoverStuckWithdrawals(dependencies),
      events,
      thresholds,
      get transactionCalls() {
        return transactionCalls;
      },
    };
  };

  it('re-publishes execution intent for a withdrawal stranded in PROCESSING', async () => {
    const harness = createHarness([stuckWithdrawal]);

    const result = await harness.useCase.execute();

    expect(result.rescheduled).toEqual([WITHDRAWAL_ID]);
    expect(harness.events).toEqual([
      {
        id: recoveryEventId(1),
        type: 'WithdrawalExecutionRequested',
        aggregateId: WITHDRAWAL_ID,
        occurredAt: new Date('2026-08-15T10:30:00.000Z'),
        payload: {
          schemaVersion: 1,
          withdrawalId: WITHDRAWAL_ID,
          userId: USER_ID,
          asset: 'USDT',
          amount: '100',
        },
      },
    ]);
    expect(harness.transactionCalls).toBe(1);
  });

  it('only considers withdrawals older than the processing timeout', async () => {
    const harness = createHarness([]);

    await harness.useCase.execute();

    expect(harness.thresholds).toEqual([
      new Date('2026-08-15T10:15:00.000Z'),
    ]);
  });

  it('issues a fresh event id so consumer deduplication cannot suppress recovery', async () => {
    const harness = createHarness([
      stuckWithdrawal,
      { ...stuckWithdrawal, withdrawalId: OTHER_WITHDRAWAL_ID },
    ]);

    await harness.useCase.execute();

    expect(harness.events.map((event) => event.id)).toEqual([
      recoveryEventId(1),
      recoveryEventId(2),
    ]);
  });

  it('writes nothing when no withdrawal is stranded', async () => {
    const harness = createHarness([]);

    const result = await harness.useCase.execute();

    expect(result.rescheduled).toEqual([]);
    expect(harness.events).toHaveLength(0);
  });
});
