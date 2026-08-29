import type { EventId } from '../identity/identity.js';

/**
 * A fact this service publishes to other services.
 *
 * `Payload` must be a plain JSON object because it is stored as `jsonb` and
 * shipped as JSON. Declare payloads with `type`, not `interface` — TypeScript
 * gives type aliases an implicit index signature and interfaces none, so an
 * interface payload will not satisfy this constraint.
 */
export interface IntegrationEvent<
  Type extends string,
  Payload extends Record<string, unknown>,
> {
  id: EventId;
  type: Type;
  /**
   * The partition key. Every event about one aggregate lands on one Kafka
   * partition, which is what makes redelivery unable to reorder its lifecycle.
   */
  aggregateId: string;
  occurredAt: Date;
  payload: Payload;
}

export type AnyIntegrationEvent = IntegrationEvent<
  string,
  Record<string, unknown>
>;

/**
 * The wire envelope, flattened: the three envelope fields sit alongside the
 * payload's own rather than nested under `payload`.
 *
 * The flattening is not free — a payload field named `eventType` would shadow
 * the envelope — but it is the shape already on the topic, and changing it is a
 * breaking change for every consumer. It is written down here, once, because it
 * was previously implicit in a `JSON.stringify` inside the outbox publisher and
 * restated by hand in the consumer's zod schema, with nothing checking the two
 * agreed.
 */
export type IntegrationEventEnvelope<
  Type extends string,
  Payload extends Record<string, unknown>,
> = {
  eventId: string;
  eventType: Type;
  /** ISO-8601. `Date` does not survive JSON. */
  occurredAt: string;
} & Payload;

export function encodeIntegrationEvent<
  Type extends string,
  Payload extends Record<string, unknown>,
>(event: {
  id: string;
  type: Type;
  occurredAt: Date;
  payload: Payload;
}): IntegrationEventEnvelope<Type, Payload> {
  return {
    eventId: event.id,
    eventType: event.type,
    occurredAt: event.occurredAt.toISOString(),
    ...event.payload,
  };
}
