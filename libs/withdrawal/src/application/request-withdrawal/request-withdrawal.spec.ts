import { Assets, Money } from '@bitex/platform';
import { RequestWithdrawal } from './request-withdrawal.js';
import type {
  RequestWithdrawalDependencies,
  RequestWithdrawalResult,
} from './request-withdrawal.js';

describe('RequestWithdrawal', () => {
  const command = {
    idempotencyKey: 'key-123',
    fingerprint: 'fingerprint-123',
    userId: 'user-123',
    asset: Assets.USDT,
    amount: Money.parse('100', Assets.USDT),
    destinationAddress: 'TXYZ123456789',
  };

  const createHarness = () => {
    const withdrawals: unknown[] = [];
    const events: unknown[] = [];
    const completions: RequestWithdrawalResult[] = [];
    let reserveCalls = 0;
    let transactionCalls = 0;
    let replay: RequestWithdrawalResult | undefined;

    const dependencies: RequestWithdrawalDependencies = {
      transactionRunner: {
        async run<T>(operation: () => Promise<T>): Promise<T> {
          transactionCalls += 1;
          return operation();
        },
      },
      idempotency: {
        async claim() {
          return replay
            ? { kind: 'REPLAY' as const, result: replay }
            : { kind: 'CLAIMED' as const };
        },
        async complete(_key, result) {
          completions.push(result);
        },
      },
      walletReservation: {
        async reserve() {
          reserveCalls += 1;
          return { reservationId: 'reservation-1' };
        },
      },
      withdrawals: {
        async add(withdrawal) {
          withdrawals.push(withdrawal);
        },
        async getById() {
          return null;
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
      withdrawalIdGenerator: { next: () => 'withdrawal-1' },
      eventIdGenerator: { next: () => 'event-1' },
      clock: { now: () => new Date('2026-08-15T10:00:00.000Z') },
    };

    return {
      useCase: new RequestWithdrawal(dependencies),
      withdrawals,
      events,
      completions,
      get reserveCalls() {
        return reserveCalls;
      },
      get transactionCalls() {
        return transactionCalls;
      },
      setReplay(result: RequestWithdrawalResult) {
        replay = result;
      },
    };
  };

  it('atomically reserves funds, creates the withdrawal and appends its event', async () => {
    const harness = createHarness();

    const result = await harness.useCase.execute(command);

    expect(result).toEqual({
      withdrawalId: 'withdrawal-1',
      status: 'PENDING',
      asset: 'USDT',
      amount: '100',
    });
    expect(harness.transactionCalls).toBe(1);
    expect(harness.reserveCalls).toBe(1);
    expect(harness.withdrawals).toHaveLength(1);
    expect(harness.events).toEqual([
      expect.objectContaining({
        id: 'event-1',
        type: 'WithdrawalExecutionRequested',
        aggregateId: 'withdrawal-1',
      }),
    ]);
    expect(harness.completions).toEqual([result]);
  });

  it('returns the stored response without repeating financial effects', async () => {
    const harness = createHarness();
    const original: RequestWithdrawalResult = {
      withdrawalId: 'withdrawal-original',
      status: 'PENDING',
      asset: 'USDT',
      amount: '100',
    };
    harness.setReplay(original);

    const result = await harness.useCase.execute(command);

    expect(result).toEqual(original);
    expect(harness.reserveCalls).toBe(0);
    expect(harness.withdrawals).toHaveLength(0);
    expect(harness.events).toHaveLength(0);
    expect(harness.completions).toHaveLength(0);
  });
});
