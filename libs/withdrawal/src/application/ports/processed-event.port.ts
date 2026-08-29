import type { EventId } from '@bitex/platform';

/**
 * Consumer-side deduplication for at-least-once delivery.
 *
 * `record` runs inside the same transaction as the state change it describes,
 * which is what makes "processed" and "applied" a single atomic fact rather
 * than two that can disagree after a crash.
 */
export interface ProcessedEventPort {
  has(eventId: EventId): Promise<boolean>;
  record(eventId: EventId): Promise<void>;
}
