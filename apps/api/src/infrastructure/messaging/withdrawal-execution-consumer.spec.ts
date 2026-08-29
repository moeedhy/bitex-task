import { WithdrawalExecutionConsumer } from './withdrawal-execution-consumer.js';
import type { DeadLetterSink } from './withdrawal-execution-consumer.js';

describe('WithdrawalExecutionConsumer', () => {
  const event = {
    eventId: 'event-1',
    eventType: 'WithdrawalExecutionRequested',
    withdrawalId: 'withdrawal-1',
    userId: 'user-123',
    asset: 'USDT',
    amount: '100',
    occurredAt: '2026-08-15T10:00:00.000Z',
  };

  const createHarness = (execute: jest.Mock) => {
    const deadLettered: Parameters<DeadLetterSink['send']>[0][] = [];
    const consumer = new WithdrawalExecutionConsumer(
      {} as never,
      'withdrawal-execution-requested',
      { execute },
      {
        async send(record) {
          deadLettered.push(record);
        },
      },
      { maxAttempts: 3, backoffMs: 0, sleep: async () => undefined },
    );
    return { consumer, deadLettered, execute };
  };

  const failWith = (code: string) =>
    Object.assign(new Error(code), { code });

  it('executes a well-formed event once', async () => {
    const harness = createHarness(jest.fn().mockResolvedValue(undefined));

    await harness.consumer.handle('withdrawal-1', JSON.stringify(event));

    expect(harness.execute).toHaveBeenCalledWith({
      eventId: 'event-1',
      withdrawalId: 'withdrawal-1',
    });
    expect(harness.deadLettered).toHaveLength(0);
  });

  it('dead-letters a message that is not valid JSON instead of blocking the partition', async () => {
    const harness = createHarness(jest.fn());

    await harness.consumer.handle('withdrawal-1', 'not-json');

    expect(harness.execute).not.toHaveBeenCalled();
    expect(harness.deadLettered).toHaveLength(1);
    expect(harness.deadLettered[0]?.reason).toBe('UNPARSEABLE_MESSAGE');
  });

  it('dead-letters a message that does not match the event contract', async () => {
    const harness = createHarness(jest.fn());

    await harness.consumer.handle(
      'withdrawal-1',
      JSON.stringify({ ...event, withdrawalId: '' }),
    );

    expect(harness.execute).not.toHaveBeenCalled();
    expect(harness.deadLettered[0]?.reason).toBe('UNPARSEABLE_MESSAGE');
  });

  it('retries a transient failure and succeeds without dead-lettering', async () => {
    const harness = createHarness(
      jest
        .fn()
        .mockRejectedValueOnce(failWith('MISSING_TRANSACTION'))
        .mockResolvedValueOnce(undefined),
    );

    await harness.consumer.handle('withdrawal-1', JSON.stringify(event));

    expect(harness.execute).toHaveBeenCalledTimes(2);
    expect(harness.deadLettered).toHaveLength(0);
  });

  it('dead-letters after exhausting retries so the offset can advance', async () => {
    const harness = createHarness(
      jest.fn().mockRejectedValue(failWith('WITHDRAWAL_EXECUTION_UNRESOLVED')),
    );

    await harness.consumer.handle('withdrawal-1', JSON.stringify(event));

    expect(harness.execute).toHaveBeenCalledTimes(3);
    expect(harness.deadLettered[0]?.reason).toBe('RETRIES_EXHAUSTED');
  });

  it('does not retry a failure that cannot become a success', async () => {
    const harness = createHarness(
      jest.fn().mockRejectedValue(failWith('WITHDRAWAL_NOT_FOUND')),
    );

    await harness.consumer.handle('withdrawal-1', JSON.stringify(event));

    expect(harness.execute).toHaveBeenCalledTimes(1);
    expect(harness.deadLettered[0]?.reason).toBe('NON_RETRYABLE_FAILURE');
    expect(harness.deadLettered[0]?.error).toBe('WITHDRAWAL_NOT_FOUND');
  });
});
