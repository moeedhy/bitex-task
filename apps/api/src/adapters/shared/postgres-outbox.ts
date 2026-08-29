import type { AnyIntegrationEvent, Outbox } from '@bitex/platform';
import { currentCorrelationId } from '../../observability/request-context.js';
import type { TransactionalClient } from './transactional-client.js';

export class PostgresOutbox implements Outbox {
  constructor(
    private readonly transaction: TransactionalClient,
  ) {}

  async append(event: AnyIntegrationEvent): Promise<void> {
    await this.transaction.client().query(
      `INSERT INTO outbox_events
        (id, event_type, aggregate_id, payload, occurred_at, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event.id,
        event.type,
        event.aggregateId,
        JSON.stringify(event.payload),
        event.occurredAt,
        // Read here rather than carried through the port: which request caused
        // an event is an observability fact, not something the domain or the
        // application layer should have to thread through their signatures.
        // Null for the recovery worker, which belongs to no request.
        currentCorrelationId() ?? null,
      ],
    );
  }
}
