import { Module } from '@nestjs/common';
import { DatabaseConnection } from '../infrastructure/shared/database-connection.js';
import { SchemaMigrator } from '../infrastructure/shared/schema-migrator.js';
import { PostgresTransactionRunner } from '../infrastructure/shared/postgres-transaction-runner.js';
import { envNumber, envString } from './env.js';

/**
 * The transaction boundary every other module participates in. Exported as the
 * concrete runner because it is the only implementation and the application
 * layer already depends on the neutral `TransactionRunner` interface.
 */
@Module({
  providers: [
    {
      provide: SchemaMigrator,
      useFactory: () =>
        new SchemaMigrator(
          envString(
            process.env.DATABASE_MIGRATIONS_DIR,
            'src/infrastructure/database/migrations',
          ),
        ),
    },
    {
      provide: DatabaseConnection,
      inject: [SchemaMigrator],
      useFactory: (migrator: SchemaMigrator) =>
        new DatabaseConnection(
          {
            connectionString: envString(
              process.env.DATABASE_URL,
              'postgresql://pooleno:pooleno@localhost:5432/pooleno',
            ),
            max: envNumber(process.env.DATABASE_POOL_MAX, 10),
          },
          {
            migrator,
            seedPath: envString(
              process.env.DATABASE_SEED_PATH,
              'src/infrastructure/database/seed.sql',
            ),
            seed: process.env.SEED_DEV_DATA === 'true',
          },
        ),
    },
    {
      provide: PostgresTransactionRunner,
      inject: [DatabaseConnection],
      useFactory: (database: DatabaseConnection) =>
        new PostgresTransactionRunner(database.pool, {
          lockTimeoutMs: envNumber(process.env.DATABASE_LOCK_TIMEOUT_MS, 3_000),
          statementTimeoutMs: envNumber(
            process.env.DATABASE_STATEMENT_TIMEOUT_MS,
            10_000,
          ),
        }),
    },
  ],
  exports: [DatabaseConnection, PostgresTransactionRunner],
})
export class PersistenceModule {}
