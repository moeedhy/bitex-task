import { OutboxPublisher, toIntegrationMessage } from './outbox-publisher.js';
import type { OutboxRow } from './outbox-publisher.js';

const row = (overrides: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 'event-1',
  event_type: 'WithdrawalExecutionRequested',
  aggregate_id: 'withdrawal-1',
  payload: { withdrawalId: 'withdrawal-1', amount: '100' },
  occurred_at: new Date('2026-08-15T10:00:00.000Z'),
  ...overrides,
});

const producer = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  send: jest.fn().mockResolvedValue(undefined),
});

describe('toIntegrationMessage', () => {
  it('keys by aggregate so one withdrawal cannot be reordered across partitions', () => {
    expect(toIntegrationMessage(row()).key).toBe('withdrawal-1');
  });

  it('flattens the payload into the documented wire envelope', () => {
    expect(JSON.parse(toIntegrationMessage(row()).value)).toEqual({
      eventId: 'event-1',
      eventType: 'WithdrawalExecutionRequested',
      occurredAt: '2026-08-15T10:00:00.000Z',
      withdrawalId: 'withdrawal-1',
      amount: '100',
    });
  });
});

describe('OutboxPublisher timer safety', () => {
  afterEach(() => jest.useRealTimers());

  /**
   * The regression this file exists for.
   *
   * The tick used to be `setInterval(() => void this.publishOnce(), …)`, which
   * discards the promise. A pool failure — routine during shutdown, since the
   * pool used to close before this timer was cleared — therefore surfaced as an
   * unhandled rejection and terminated the process. The assertion is that a
   * failing tick is survivable, not that it succeeds.
   */
  it('survives a database failure inside a tick instead of crashing the process', async () => {
    jest.useFakeTimers();
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    const pool = {
      connect: jest.fn().mockRejectedValue(new Error('pool is ended')),
      query: jest.fn(),
    };
    const publisher = new OutboxPublisher(
      pool as never,
      producer() as never,
      'withdrawal-execution-requested',
      { intervalMs: 10 },
    );

    await publisher.start();
    await jest.advanceTimersByTimeAsync(35);
    await publisher.stop();

    process.off('unhandledRejection', unhandled);
    expect(pool.connect).toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('ignores a second start so the first interval cannot be orphaned', async () => {
    jest.useFakeTimers();
    const kafka = producer();
    const pool = { connect: jest.fn(), query: jest.fn() };
    const publisher = new OutboxPublisher(
      pool as never,
      kafka as never,
      'topic',
      { intervalMs: 10 },
    );

    await publisher.start();
    await publisher.start();

    expect(kafka.connect).toHaveBeenCalledTimes(1);
    await publisher.stop();
  });

  it('stops cleanly twice, so shutdown is idempotent', async () => {
    jest.useFakeTimers();
    const kafka = producer();
    const pool = { connect: jest.fn(), query: jest.fn() };
    const publisher = new OutboxPublisher(
      pool as never,
      kafka as never,
      'topic',
      { intervalMs: 10 },
    );

    await publisher.start();
    await publisher.stop();
    await expect(publisher.stop()).resolves.toBeUndefined();
  });
});
