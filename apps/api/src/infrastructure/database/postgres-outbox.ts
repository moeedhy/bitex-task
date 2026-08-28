import type { IntegrationEvent, Outbox } from '@bitex/platform';
import type { PostgresTransactionRunner } from './postgres-transaction-runner.js';

export class PostgresOutbox implements Outbox {
  constructor(
    private readonly transaction: Pick<PostgresTransactionRunner, 'client'>,
  ) {}

  async append(event: IntegrationEvent): Promise<void> {
    await this.transaction.client().query(
      `INSERT INTO outbox_events
        (id, event_type, aggregate_id, payload, occurred_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        event.id,
        event.type,
        event.aggregateId,
        JSON.stringify(event.payload),
        event.occurredAt,
      ],
    );
  }
}
