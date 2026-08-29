import type { EventId, WithdrawalId } from '@bitex/platform';

/**
 * Driven by a Kafka message, so both fields arrive from outside and are parsed
 * at that edge. `eventId` is what deduplication keys on; `withdrawalId` is what
 * is locked.
 */
export interface ExecuteWithdrawalCommand {
  eventId: EventId;
  withdrawalId: WithdrawalId;
}
