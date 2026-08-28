import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { Producer } from 'kafkajs';
import type { Pool, PoolClient } from 'pg';

interface OutboxRow {
  id: string;
  event_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
}

export class OutboxPublisher {
  private readonly logger = new Logger(OutboxPublisher.name);
  private timer?: NodeJS.Timeout;
  private readonly publisherId = randomUUID();

  constructor(
    private readonly pool: Pool,
    private readonly producer: Producer,
    private readonly topic: string,
    private readonly intervalMs = 1000,
  ) {}

  async start(): Promise<void> {
    await this.producer.connect();
    this.timer = setInterval(() => void this.publishOnce(), this.intervalMs);
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
          messages: [
            {
              key: row.aggregate_id,
              value: JSON.stringify({
                eventId: row.id,
                eventType: row.event_type,
                occurredAt: row.occurred_at.toISOString(),
                ...row.payload,
              }),
            },
          ],
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
    return rows.length;
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
       SET locked_by = $1, locked_until = now() + interval '30 seconds'
       WHERE id IN (
         SELECT id FROM outbox_events
         WHERE published_at IS NULL
           AND available_at <= now()
           AND (locked_until IS NULL OR locked_until < now())
         ORDER BY occurred_at
         FOR UPDATE SKIP LOCKED
         LIMIT 20
       )
       RETURNING id, event_type, aggregate_id, payload, occurred_at`,
      [this.publisherId],
    );
  }
}
