import { MissingTransactionError } from './postgres-transaction-runner.js';
import { PostgresTransactionRunner } from './postgres-transaction-runner.js';

describe('PostgresTransactionRunner', () => {
  const createHarness = () => {
    const queries: string[] = [];
    let releases = 0;
    const client = {
      async query(sql: string) {
        queries.push(sql);
        return { rows: [], rowCount: 0 };
      },
      release() {
        releases += 1;
      },
    };
    const pool = { connect: async () => client };
    return {
      runner: new PostgresTransactionRunner(pool as never),
      client,
      queries,
      get releases() {
        return releases;
      },
    };
  };

  it('binds one client to the operation and commits it', async () => {
    const harness = createHarness();

    await harness.runner.run(async () => {
      expect(harness.runner.client()).toBe(harness.client);
    });

    expect(harness.queries).toEqual(['BEGIN', 'COMMIT']);
    expect(harness.releases).toBe(1);
  });

  it('joins an existing transaction rather than opening a nested transaction', async () => {
    const harness = createHarness();

    await harness.runner.run(async () => {
      await harness.runner.run(async () => undefined);
    });

    expect(harness.queries).toEqual(['BEGIN', 'COMMIT']);
  });

  it('rolls back and releases the client after failure', async () => {
    const harness = createHarness();

    await expect(
      harness.runner.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(harness.queries).toEqual(['BEGIN', 'ROLLBACK']);
    expect(harness.releases).toBe(1);
  });

  it('fails fast when a financial repository requests a client outside a transaction', () => {
    const harness = createHarness();

    expect(() => harness.runner.client()).toThrow(MissingTransactionError);
  });
});
