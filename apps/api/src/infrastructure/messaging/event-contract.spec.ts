import { Assets, Money } from '@bitex/platform';
import type { IntegrationEvent } from '@bitex/platform';
import { RequestWithdrawal } from '@bitex/withdrawal';
import { toIntegrationMessage } from './outbox-publisher.js';
import type { OutboxRow } from './outbox-publisher.js';
import { WithdrawalExecutionConsumer } from './withdrawal-execution-consumer.js';
import type { DeadLetterSink } from './withdrawal-execution-consumer.js';

/**
 * Producer and consumer are written in different libraries and validated by a
 * strict schema, so a field added or removed on one side silently dead-letters
 * every message on the other. Nothing else in the suite crosses that seam:
 * the consumer tests build their own fixture, and the PostgreSQL tests call
 * ExecuteWithdrawal directly.
 *
 * This drives the real event through the real envelope into the real schema.
 */
describe('WithdrawalExecutionRequested contract', () => {
  const publishedEvent = async (): Promise<IntegrationEvent> => {
    const events: IntegrationEvent[] = [];
    const useCase = new RequestWithdrawal({
      transactionRunner: { run: (operation) => operation() },
      idempotency: {
        async claim() {
          return { kind: 'CLAIMED' };
        },
        async complete() {
          return;
        },
      },
      walletReservation: {
        async reserve() {
          return { reservationId: 'reservation-1' };
        },
      },
      withdrawals: {
        async add() {
          return;
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
    });

    await useCase.execute({
      idempotencyKey: 'key-123',
      userId: 'user-123',
      amount: Money.parse('100', Assets.USDT),
      destinationAddress: 'TXYZ123456789',
    });

    const event = events[0];
    if (!event) throw new Error('the workflow appended no event');
    return event;
  };

  /** Mirrors the outbox row the event becomes once persisted and read back. */
  const asOutboxRow = (event: IntegrationEvent): OutboxRow => ({
    id: event.id,
    event_type: event.type,
    aggregate_id: event.aggregateId,
    payload: event.payload,
    occurred_at: event.occurredAt,
  });

  it('produces a message the consumer accepts and acts on', async () => {
    const event = await publishedEvent();
    const message = toIntegrationMessage(asOutboxRow(event));
    const deadLettered: Parameters<DeadLetterSink['send']>[0][] = [];
    const execute = jest.fn().mockResolvedValue(undefined);
    const consumer = new WithdrawalExecutionConsumer(
      {} as never,
      'withdrawal-execution-requested',
      { execute },
      {
        async send(record) {
          deadLettered.push(record);
        },
      },
    );

    await consumer.handle(message.key, message.value);

    expect(deadLettered).toEqual([]);
    expect(execute).toHaveBeenCalledWith({
      eventId: 'event-1',
      withdrawalId: 'withdrawal-1',
    });
  });

  it('carries exactly the documented event fields', async () => {
    const event = await publishedEvent();

    expect(JSON.parse(toIntegrationMessage(asOutboxRow(event)).value)).toEqual({
      eventId: 'event-1',
      eventType: 'WithdrawalExecutionRequested',
      withdrawalId: 'withdrawal-1',
      userId: 'user-123',
      asset: 'USDT',
      amount: '100',
      occurredAt: '2026-08-15T10:00:00.000Z',
    });
  });

  it('partitions by withdrawal so one aggregate keeps its ordering', async () => {
    const event = await publishedEvent();

    expect(toIntegrationMessage(asOutboxRow(event)).key).toBe('withdrawal-1');
  });
});
