import type { ProcessedEventPort } from '@bitex/withdrawal';
import type { PostgresTransactionRunner } from '../shared/postgres-transaction-runner.js';

export class PostgresProcessedEvents implements ProcessedEventPort {
  constructor(
    private readonly transaction: Pick<PostgresTransactionRunner, 'client'>,
  ) {}

  async has(eventId: string): Promise<boolean> {
    const result = await this.transaction
      .client()
      .query('SELECT 1 FROM processed_events WHERE event_id = $1', [eventId]);
    return result.rowCount === 1;
  }

  async record(eventId: string): Promise<void> {
    await this.transaction.client().query(
      `INSERT INTO processed_events(event_id) VALUES ($1)
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId],
    );
  }
}
