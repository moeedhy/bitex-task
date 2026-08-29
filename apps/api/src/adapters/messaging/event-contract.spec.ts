import { Assets, Money } from '@bitex/platform';
import type { AnyIntegrationEvent } from '@bitex/platform';
import { RequestWithdrawal } from '@bitex/withdrawal';
import { toIntegrationMessage } from './outbox-publisher.js';
import type { OutboxRow } from './outbox-publisher.js';
import { WithdrawalExecutionConsumer } from './withdrawal-execution-consumer.js';
import type { DeadLetterSink } from './withdrawal-execution-consumer.js';
import { EventId, ReservationId, UserId, WithdrawalId } from '@bitex/platform';

// Fixed identities. Parsed rather than cast, so the fixtures are
// exactly what the production edges accept.
const WITHDRAWAL_ID = WithdrawalId.parse('11111111-1111-4111-8111-111111111111');
const USER_ID = UserId.parse('22222222-2222-4222-8222-222222222222');
const RESERVATION_ID = ReservationId.parse('44444444-4444-4444-8444-444444444444');
const EVENT_ID = EventId.parse('55555555-5555-4555-8555-555555555555');

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
  const publishedEvent = async (): Promise<AnyIntegrationEvent> => {
    const events: AnyIntegrationEvent[] = [];
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
          return { reservationId: RESERVATION_ID };
        },
      },
      withdrawals: {
        async add() {
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
    });

    await useCase.execute({
      idempotencyKey: 'key-123',
      userId: USER_ID,
      amount: Money.parse('100', Assets.USDT),
      destinationAddress: 'TXYZ123456789',
    });

    const event = events[0];
    if (!event) throw new Error('the workflow appended no event');
    return event;
  };

  /** Mirrors the outbox row the event becomes once persisted and read back. */
  const asOutboxRow = (event: AnyIntegrationEvent): OutboxRow => ({
    id: event.id,
    event_type: event.type,
    aggregate_id: event.aggregateId,
    payload: event.payload,
    occurred_at: event.occurredAt,
    correlation_id: 'corr-1',
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
      eventId: EVENT_ID,
      withdrawalId: WITHDRAWAL_ID,
    });
  });

  it('carries exactly the documented event fields', async () => {
    const event = await publishedEvent();

    expect(JSON.parse(toIntegrationMessage(asOutboxRow(event)).value)).toEqual({
      eventId: EVENT_ID,
      eventType: 'WithdrawalExecutionRequested',
      schemaVersion: 1,
      withdrawalId: WITHDRAWAL_ID,
      userId: USER_ID,
      asset: 'USDT',
      // A decimal string, never a number: 100.000001 USDT does not survive an
      // IEEE-754 double, and the scale is the receiver's to decide.
      amount: '100',
      occurredAt: '2026-08-15T10:00:00.000Z',
    });
  });

  it('partitions by withdrawal so one aggregate keeps its ordering', async () => {
    const event = await publishedEvent();

    expect(toIntegrationMessage(asOutboxRow(event)).key).toBe(WITHDRAWAL_ID);
  });
});
