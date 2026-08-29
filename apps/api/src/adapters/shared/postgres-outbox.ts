import type { AnyIntegrationEvent, Outbox } from '@bitex/platform';
import type { TransactionalClient } from './transactional-client.js';

export class PostgresOutbox implements Outbox {
  constructor(
    private readonly transaction: TransactionalClient,
  ) {}

  async append(event: AnyIntegrationEvent): Promise<void> {
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
