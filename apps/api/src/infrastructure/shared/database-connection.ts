import { readFile } from 'node:fs/promises';
import { Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import type { PoolConfig } from 'pg';
import type { SchemaMigrator } from './schema-migrator.js';

export interface SchemaOptions {
  /** Applied at startup, once each, in filename order. */
  migrator: SchemaMigrator;
  /** Development convenience only; ignored unless `seed` is true. */
  seedPath: string;
  seed: boolean;
}

/**
 * Owns the single connection pool, its lifecycle, and bringing the schema up to
 * date before anything else is allowed to query.
 *
 * The pool is bounded and deliberately shared: the HTTP path, the outbox
 * publisher, the recovery worker and the read model all draw from it, so
 * contention between them is visible and bounded rather than hidden behind
 * separate unbounded pools.
 */
export class DatabaseConnection implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseConnection.name);
  readonly pool: Pool;

  constructor(
    config: PoolConfig,
    private readonly schema: SchemaOptions,
  ) {
    this.pool = new Pool(config);
  }

  async onModuleInit(): Promise<void> {
    await this.pool.query('SELECT 1');
    const applied = await this.schema.migrator.run(this.pool);
    if (this.schema.seed) {
      await this.pool.query(await readFile(this.schema.seedPath, 'utf8'));
    }
    this.logger.log({
      operation: 'database-connect',
      result: 'ready',
      migrationsApplied: applied.length,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
