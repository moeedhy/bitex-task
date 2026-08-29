import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { Producer } from 'kafkajs';
import type { Pool, PoolClient } from 'pg';

export interface OutboxRow {
  id: string;
  event_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
}

export interface OutboxPublisherOptions {
  intervalMs: number;
  /** How long a published row is kept before it is pruned. */
  retentionMs: number;
  /** How often pruning is attempted, independent of the publish cadence. */
  pruneIntervalMs: number;
  batchSize: number;
  leaseSeconds: number;
}

const DEFAULT_OPTIONS: OutboxPublisherOptions = {
  intervalMs: 1_000,
  retentionMs: 7 * 24 * 60 * 60 * 1000,
  pruneIntervalMs: 60 * 60 * 1000,
  batchSize: 20,
  leaseSeconds: 30,
};

/**
 * The wire envelope. Exported so the producer/consumer contract can be tested
 * against the real serialisation rather than a re-implementation of it.
 */
export function toIntegrationMessage(row: OutboxRow): {
  key: string;
  value: string;
} {
  return {
    // Keying by aggregate keeps every event for one withdrawal on a single
    // partition, so redelivery cannot reorder its lifecycle.
    key: row.aggregate_id,
    value: JSON.stringify({
      eventId: row.id,
      eventType: row.event_type,
      occurredAt: row.occurred_at.toISOString(),
      ...row.payload,
    }),
  };
}

/**
 * Relays committed outbox rows to Kafka.
 *
 * Rows are leased with `FOR UPDATE SKIP LOCKED` so multiple replicas can run
 * concurrently. Publication is marked *after* the broker acknowledges, which is
 * why a crash in that window republishes: at-least-once by construction, which
 * the consumer's deduplication is designed to absorb.
 */
export class OutboxPublisher {
  private readonly logger = new Logger(OutboxPublisher.name);
  private readonly options: OutboxPublisherOptions;
  private readonly publisherId = randomUUID();
  private timer?: NodeJS.Timeout;
  private lastPrunedAt = 0;

  constructor(
    private readonly pool: Pool,
    private readonly producer: Producer,
    private readonly topic: string,
    options: Partial<OutboxPublisherOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async start(): Promise<void> {
    await this.producer.connect();
    this.timer = setInterval(
      () => void this.publishOnce(),
      this.options.intervalMs,
    );
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.producer.disconnect();
  }

  async publishOnce(): Promise<number> {
    const rows = await this.claimBatch();
    for (const row of rows) {
      try {
        await this.producer.send({
          topic: this.topic,
          messages: [toIntegrationMessage(row)],
        });
        await this.pool.query(
          `UPDATE outbox_events
           SET published_at = now(), locked_until = NULL, locked_by = NULL
           WHERE id = $1 AND locked_by = $2`,
          [row.id, this.publisherId],
        );
        this.logger.log({
          eventId: row.id,
          withdrawalId: row.aggregate_id,
          operation: 'publish-outbox',
          result: 'published',
        });
      } catch (error) {
        await this.pool.query(
          `UPDATE outbox_events
           SET attempts = attempts + 1,
               available_at = now() + (LEAST(attempts + 1, 30) * interval '1 second'),
               locked_until = NULL, locked_by = NULL
           WHERE id = $1 AND locked_by = $2`,
          [row.id, this.publisherId],
        );
        this.logger.warn({
          eventId: row.id,
          withdrawalId: row.aggregate_id,
          operation: 'publish-outbox',
          result: 'retry-scheduled',
          errorCode: (error as Error).name,
        });
      }
    }
    await this.pruneIfDue();
    return rows.length;
  }

  /**
   * Published rows are kept for a while as an audit trail, then removed. Without
   * this the table grows without bound and the partial index over unpublished
   * rows slowly loses its advantage.
   */
  async pruneIfDue(now = Date.now()): Promise<number> {
    if (now - this.lastPrunedAt < this.options.pruneIntervalMs) {
      return 0;
    }
    this.lastPrunedAt = now;
    const cutoff = new Date(now - this.options.retentionMs);
    const result = await this.pool.query(
      'DELETE FROM outbox_events WHERE published_at IS NOT NULL AND published_at < $1',
      [cutoff],
    );
    const removed = result.rowCount ?? 0;
    if (removed > 0) {
      this.logger.log({
        operation: 'prune-outbox',
        result: 'pruned',
        removed,
      });
    }
    return removed;
  }

  private async claimBatch(): Promise<OutboxRow[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await this.claim(client);
      await client.query('COMMIT');
      return result.rows;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private claim(client: PoolClient) {
    return client.query<OutboxRow>(
      `UPDATE outbox_events
       SET locked_by = $1, locked_until = now() + ($3 * interval '1 second')
       WHERE id IN (
         SELECT id FROM outbox_events
         WHERE published_at IS NULL
           AND available_at <= now()
           AND (locked_until IS NULL OR locked_until < now())
         ORDER BY occurred_at
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       RETURNING id, event_type, aggregate_id, payload, occurred_at`,
      [this.publisherId, this.options.batchSize, this.options.leaseSeconds],
    );
  }
}
