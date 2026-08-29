import type { IntegrationEvent } from '@bitex/platform';
import { RecoverStuckWithdrawals } from './recover-stuck-withdrawals.js';
import type {
  RecoverStuckWithdrawalsDependencies,
  StuckWithdrawal,
} from './recover-stuck-withdrawals.js';

describe('RecoverStuckWithdrawals', () => {
  const stuckWithdrawal: StuckWithdrawal = {
    withdrawalId: 'withdrawal-1',
    userId: 'user-123',
    asset: 'USDT',
    amount: '100',
  };

  const createHarness = (stuck: StuckWithdrawal[]) => {
    const events: IntegrationEvent[] = [];
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
        next: () => `recovery-event-${++eventIds}`,
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

    expect(result.rescheduled).toEqual(['withdrawal-1']);
    expect(harness.events).toEqual([
      {
        id: 'recovery-event-1',
        type: 'WithdrawalExecutionRequested',
        aggregateId: 'withdrawal-1',
        occurredAt: new Date('2026-08-15T10:30:00.000Z'),
        payload: {
          withdrawalId: 'withdrawal-1',
          userId: 'user-123',
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
      { ...stuckWithdrawal, withdrawalId: 'withdrawal-2' },
    ]);

    await harness.useCase.execute();

    expect(harness.events.map((event) => event.id)).toEqual([
      'recovery-event-1',
      'recovery-event-2',
    ]);
  });

  it('writes nothing when no withdrawal is stranded', async () => {
    const harness = createHarness([]);

    const result = await harness.useCase.execute();

    expect(result.rescheduled).toEqual([]);
    expect(harness.events).toHaveLength(0);
  });
});
