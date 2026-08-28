import { Assets, Money } from '@bitex/platform';
import { Withdrawal } from '../../domain/withdrawal.js';
import { ExecuteWithdrawal } from './execute-withdrawal.js';
import type { ExecuteWithdrawalDependencies } from './execute-withdrawal.js';

describe('ExecuteWithdrawal', () => {
  const createHarness = (providerStatus: 'SUCCESS' | 'FAILED' = 'SUCCESS') => {
    const withdrawal = Withdrawal.request({
      id: 'withdrawal-1',
      userId: 'user-123',
      asset: Assets.USDT,
      amount: Money.parse('100', Assets.USDT),
      destinationAddress: 'TXYZ123456789',
      reservationId: 'reservation-1',
      createdAt: new Date('2026-08-15T10:00:00.000Z'),
    });
    const processed = new Set<string>();
    let providerCalls = 0;
    let finalizeCalls = 0;
    let releaseCalls = 0;
    let transactionCalls = 0;

    const dependencies: ExecuteWithdrawalDependencies = {
      transactionRunner: {
        async run<T>(operation: () => Promise<T>): Promise<T> {
          transactionCalls += 1;
          return operation();
        },
      },
      withdrawals: {
        async add() {
          return;
        },
        async getById() {
          return withdrawal;
        },
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
        async finalize() {
          finalizeCalls += 1;
        },
        async release() {
          releaseCalls += 1;
        },
      },
      provider: {
        async execute() {
          providerCalls += 1;
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
      get finalizeCalls() {
        return finalizeCalls;
      },
      get releaseCalls() {
        return releaseCalls;
      },
      get transactionCalls() {
        return transactionCalls;
      },
    };
  };

  it('completes and finalizes a successful provider execution', async () => {
    const harness = createHarness('SUCCESS');

    await harness.useCase.execute({
      eventId: 'event-1',
      withdrawalId: 'withdrawal-1',
    });

    expect(harness.withdrawal.status).toBe('COMPLETED');
    expect(harness.withdrawal.transactionReference).toBe('tx-1');
    expect(harness.finalizeCalls).toBe(1);
    expect(harness.releaseCalls).toBe(0);
    expect(harness.processed.has('event-1')).toBe(true);
    expect(harness.transactionCalls).toBe(2);
  });

  it('fails and releases a failed provider execution', async () => {
    const harness = createHarness('FAILED');

    await harness.useCase.execute({
      eventId: 'event-1',
      withdrawalId: 'withdrawal-1',
    });

    expect(harness.withdrawal.status).toBe('FAILED');
    expect(harness.finalizeCalls).toBe(0);
    expect(harness.releaseCalls).toBe(1);
    expect(harness.processed.has('event-1')).toBe(true);
  });

  it('does not call the provider or settle a processed event twice', async () => {
    const harness = createHarness('SUCCESS');
    harness.processed.add('event-1');

    await harness.useCase.execute({
      eventId: 'event-1',
      withdrawalId: 'withdrawal-1',
    });

    expect(harness.providerCalls).toBe(0);
    expect(harness.finalizeCalls).toBe(0);
    expect(harness.releaseCalls).toBe(0);
    expect(harness.transactionCalls).toBe(1);
  });
});
