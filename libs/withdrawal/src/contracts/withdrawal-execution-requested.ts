import { encodeIntegrationEvent, EventId, isUuid } from '@bitex/platform';
import type {
  IntegrationEvent,
  IntegrationEventEnvelope,
  UserId,
  WithdrawalId,
} from '@bitex/platform';
import { z } from 'zod';
import type { WithdrawalExecutionRequested as RequestedDomainEvent } from '../domain/withdrawal.events.js';

export const WITHDRAWAL_EXECUTION_REQUESTED =
  'WithdrawalExecutionRequested' as const;

export type WithdrawalExecutionRequestedType =
  typeof WITHDRAWAL_EXECUTION_REQUESTED;

/**
 * Bumped only for a change a deployed consumer cannot understand. Additive
 * fields do not bump it — see the schema below for why they do not need to.
 */
export const SCHEMA_VERSION = 1;

/**
 * The published language of this context.
 *
 * One definition, owned by the producer, imported by both sides. It previously
 * existed in three places in two shapes — hand-built in `RequestWithdrawal`,
 * hand-built again in `RecoverStuckWithdrawals` with no test covering it, and
 * restated a third time as the consumer's zod schema — with nothing checking
 * that any of them agreed.
 *
 * Amounts cross the wire as decimal strings, never as numbers: `100.000001`
 * USDT does not survive an IEEE-754 double, and the receiving side must be the
 * one to decide the atomic-unit scale.
 */
export type WithdrawalExecutionRequestedPayload = {
  schemaVersion: number;
  withdrawalId: WithdrawalId;
  userId: UserId;
  asset: string;
  amount: string;
};

export type WithdrawalExecutionRequestedEvent = IntegrationEvent<
  WithdrawalExecutionRequestedType,
  WithdrawalExecutionRequestedPayload
>;

const identifier = z.string().refine(isUuid, 'must be a UUID');

/**
 * Deliberately `z.object`, not `z.strictObject`.
 *
 * A producer that starts sending an extra field is a routine, additive change.
 * Under `strictObject` it dead-letters 100% of traffic on every consumer that
 * has not been redeployed yet — the deployment order becomes load-bearing, and
 * getting it wrong takes the whole withdrawal pipeline down. Unknown fields are
 * ignored instead; `schemaVersion` is what a genuinely breaking change moves.
 */
const schema = z.object({
  eventId: identifier,
  eventType: z.literal(WITHDRAWAL_EXECUTION_REQUESTED),
  occurredAt: z.iso.datetime(),
  // Absent on anything produced before versioning existed, which is v1 by
  // definition. A future `schemaVersion: 2` fails this literal and is
  // dead-lettered rather than misread — which is the point of carrying it.
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  withdrawalId: identifier,
  userId: identifier,
  asset: z.string().min(1),
  amount: z.string().min(1),
});

export type WithdrawalExecutionRequestedMessage = z.infer<typeof schema>;

/**
 * Builds the integration event from the aggregate's own domain event, so the
 * two cannot drift: the published fact is derived from the recorded one.
 */
export function withdrawalExecutionRequested(
  event: RequestedDomainEvent,
  eventId: EventId,
): WithdrawalExecutionRequestedEvent {
  return {
    id: eventId,
    type: WITHDRAWAL_EXECUTION_REQUESTED,
    // Partitioning by withdrawal keeps one aggregate's lifecycle on one
    // partition, so redelivery cannot reorder it.
    aggregateId: event.withdrawalId,
    occurredAt: event.occurredAt,
    payload: {
      schemaVersion: SCHEMA_VERSION,
      withdrawalId: event.withdrawalId,
      userId: event.userId,
      asset: event.asset.code,
      amount: event.amount.toDecimalString(),
    },
  };
}

/**
 * The wire form, exported so a test can assert the producer and the consumer
 * agree on the real serialisation rather than on a re-implementation of it.
 */
export function encodeWithdrawalExecutionRequested(
  event: WithdrawalExecutionRequestedEvent,
): IntegrationEventEnvelope<
  WithdrawalExecutionRequestedType,
  WithdrawalExecutionRequestedPayload
> {
  return encodeIntegrationEvent(event);
}

export function parseWithdrawalExecutionRequested(
  raw: unknown,
): z.ZodSafeParseResult<WithdrawalExecutionRequestedMessage> {
  return schema.safeParse(raw);
}
