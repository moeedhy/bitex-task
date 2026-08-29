import { Module } from '@nestjs/common';
import { provide, token, TRANSACTION_RUNNER } from '@bitex/platform/nest';
import { APP_CONFIG } from '../config/config.module.js';
import { DatabaseConnection } from '../adapters/shared/database-connection.js';
import { PostgresTransactionRunner } from '../adapters/shared/postgres-transaction-runner.js';
import { SchemaMigrator } from '../adapters/shared/schema-migrator.js';
import type { TransactionalClient } from '../adapters/shared/transactional-client.js';

export const DATABASE = token<DatabaseConnection>('DatabaseConnection');

/**
 * The transaction-bound client, for adapters only. Published separately from
 * `TRANSACTION_RUNNER` so the libraries see a runner they can only `run` on,
 * while the adapters see the client they need to enlist — two views of one
 * instance, neither of them the class.
 */
export const TRANSACTIONAL_CLIENT =
  token<TransactionalClient>('TransactionalClient');

const MIGRATOR = token<SchemaMigrator>('SchemaMigrator');
const RUNNER = token<PostgresTransactionRunner>('PostgresTransactionRunner');

/**
 * The PostgreSQL connection and the transaction boundary every context
 * participates in.
 *
 * `TRANSACTION_RUNNER` is platform's token, not this module's: the libraries
 * depend on the neutral `TransactionRunner` interface, and this is where the one
 * implementation is bound to it.
 */
@Module({
  providers: [
    provide(
      MIGRATOR,
      [APP_CONFIG],
      (config) => new SchemaMigrator(config.DATABASE_MIGRATIONS_DIR),
    ),
    provide(
      DATABASE,
      [APP_CONFIG, MIGRATOR],
      (config, migrator) =>
        new DatabaseConnection(
          {
            connectionString: config.DATABASE_URL,
            max: config.DATABASE_POOL_MAX,
          },
          {
            migrator,
            seedPath: config.DATABASE_SEED_PATH,
            seed: config.SEED_DEV_DATA,
          },
        ),
    ),
    provide(
      RUNNER,
      [DATABASE, APP_CONFIG],
      (database, config) =>
        new PostgresTransactionRunner(database.pool, {
          lockTimeoutMs: config.DATABASE_LOCK_TIMEOUT_MS,
          statementTimeoutMs: config.DATABASE_STATEMENT_TIMEOUT_MS,
        }),
    ),
    provide(TRANSACTION_RUNNER, [RUNNER], (runner) => runner),
    provide(TRANSACTIONAL_CLIENT, [RUNNER], (runner) => runner),
  ],
  exports: [DATABASE, TRANSACTION_RUNNER, TRANSACTIONAL_CLIENT],
})
export class PersistenceModule {}
