import { OutboxPublisher, toIntegrationMessage } from './outbox-publisher.js';
import type { OutboxRow } from './outbox-publisher.js';
import { EventId, WithdrawalId } from '@bitex/platform';

// Fixed identities. Parsed rather than cast, so the fixtures are
// exactly what the production edges accept.
const WITHDRAWAL_ID = WithdrawalId.parse('11111111-1111-4111-8111-111111111111');
const EVENT_ID = EventId.parse('55555555-5555-4555-8555-555555555555');

const row = (overrides: Partial<OutboxRow> = {}): OutboxRow => ({
  id: EVENT_ID,
  event_type: 'WithdrawalExecutionRequested',
  aggregate_id: WITHDRAWAL_ID,
  payload: { withdrawalId: WITHDRAWAL_ID, amount: '100' },
  occurred_at: new Date('2026-08-15T10:00:00.000Z'),
  correlation_id: null,
  ...overrides,
});

const producer = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  send: jest.fn().mockResolvedValue(undefined),
});

describe('toIntegrationMessage', () => {
  it('keys by aggregate so one withdrawal cannot be reordered across partitions', () => {
    expect(toIntegrationMessage(row()).key).toBe(WITHDRAWAL_ID);
  });

  it('flattens the payload into the documented wire envelope', () => {
    expect(JSON.parse(toIntegrationMessage(row()).value)).toEqual({
      eventId: EVENT_ID,
      eventType: 'WithdrawalExecutionRequested',
      occurredAt: '2026-08-15T10:00:00.000Z',
      withdrawalId: WITHDRAWAL_ID,
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

  describe('correlation', () => {
    it('carries the originating request id as a Kafka header', () => {
      const message = toIntegrationMessage(row({ correlation_id: 'corr-1' }));

      expect(message.headers).toEqual({ 'x-correlation-id': 'corr-1' });
    });

    /**
     * Recovery re-publishes an intent that belongs to no request, and rows
     * written before the column existed have no id. Neither should produce a
     * header at all rather than an empty one.
     */
    it('sends no header when there is nothing to correlate', () => {
      expect(toIntegrationMessage(row()).headers).toBeUndefined();
    });

    /**
     * A header, not a payload field: the correlation id is transport metadata
     * that no consumer must understand, and putting it in the payload would
     * make it part of the versioned contract.
     */
    it('keeps the correlation id out of the versioned payload', () => {
      const message = toIntegrationMessage(row({ correlation_id: 'corr-1' }));

      expect(JSON.parse(message.value)).not.toHaveProperty('correlationId');
      expect(message.value).not.toContain('corr-1');
    });
  });
});
