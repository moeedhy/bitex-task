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

export interface TransactionLimits {
  /**
   * Longest a statement may wait for a row lock. Withdrawal requests contend on
   * the wallet row and on the idempotency row; without a bound, a duplicate
   * burst parks pooled connections indefinitely and can starve the outbox
   * publisher, which shares the pool.
   */
  lockTimeoutMs: number;
  /** Longest any single statement may run before the transaction aborts. */
  statementTimeoutMs: number;
}

const DEFAULT_LIMITS: TransactionLimits = {
  lockTimeoutMs: 3_000,
  statementTimeoutMs: 10_000,
};

export class PostgresTransactionRunner implements TransactionRunner {
  private readonly storage = new AsyncLocalStorage<PoolClient>();
  private readonly limits: TransactionLimits;

  constructor(
    private readonly pool: Pick<Pool, 'connect'>,
    limits: Partial<TransactionLimits> = {},
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  /**
   * Re-entrant by design: a nested `run` joins the active transaction instead
   * of opening a second one, so a wallet operation invoked from a withdrawal
   * workflow is a participant rather than its own transaction owner.
   */
  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.storage.getStore()) {
      return operation();
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.applyLimits(client);
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

  /**
   * `set_config(..., true)` scopes both limits to the current transaction, so
   * they travel with the connection back to the pool cleanly.
   */
  private async applyLimits(client: Pick<PoolClient, 'query'>): Promise<void> {
    await client.query('SELECT set_config($1, $2, true), set_config($3, $4, true)', [
      'lock_timeout',
      `${this.limits.lockTimeoutMs}ms`,
      'statement_timeout',
      `${this.limits.statementTimeoutMs}ms`,
    ]);
  }
}
