import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';

/**
 * Arbitrary but stable key, so concurrent replicas serialise on the same lock.
 */
const MIGRATION_LOCK_KEY = 4_814_072_025;

/**
 * Applies pending SQL migrations at startup.
 *
 * Relying on Postgres' `docker-entrypoint-initdb.d` alone is a trap: those
 * scripts run exactly once, when the data directory is empty. Any environment
 * created before a migration existed keeps an old schema forever and fails at
 * runtime on the first query that needs the new column — silently, and only for
 * the developers who already had a volume.
 *
 * Each file is applied once, inside its own transaction, and recorded. An
 * advisory lock held for the whole run means several replicas booting together
 * cannot race.
 */
export class SchemaMigrator {
  private readonly logger = new Logger(SchemaMigrator.name);

  constructor(private readonly directory: string) {}

  async run(pool: Pool): Promise<string[]> {
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           version TEXT PRIMARY KEY,
           applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
         )`,
      );
      const applied = await client.query<{ version: string }>(
        'SELECT version FROM schema_migrations',
      );
      const already = new Set(applied.rows.map((row) => row.version));

      const files = (await readdir(this.directory))
        .filter((name) => name.endsWith('.sql'))
        .sort();

      const executed: string[] = [];
      for (const file of files) {
        if (already.has(file)) {
          continue;
        }
        const sql = await readFile(join(this.directory, file), 'utf8');
        try {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query(
            'INSERT INTO schema_migrations(version) VALUES ($1)',
            [file],
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
        executed.push(file);
        this.logger.log({
          operation: 'migrate',
          result: 'applied',
          version: file,
        });
      }
      return executed;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
      client.release();
    }
  }
}
