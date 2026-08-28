import type { TransactionRunner } from '@bitex/platform';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool, PoolClient } from 'pg';

export class MissingTransactionError extends Error {
  readonly code = 'MISSING_TRANSACTION' as const;

  constructor() {
    super('A transaction-bound PostgreSQL client is required.');
    this.name = 'MissingTransactionError';
  }
}

export class PostgresTransactionRunner implements TransactionRunner {
  private readonly storage = new AsyncLocalStorage<PoolClient>();

  constructor(private readonly pool: Pick<Pool, 'connect'>) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.storage.getStore()) {
      return operation();
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await this.storage.run(client, operation);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  client(): PoolClient {
    const client = this.storage.getStore();
    if (!client) {
      throw new MissingTransactionError();
    }
    return client;
  }
}
