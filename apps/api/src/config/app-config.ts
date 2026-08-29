import { z } from 'zod';

/**
 * Every environment variable this service reads, in one place, validated once
 * at boot.
 *
 * Previously there were twenty-five `process.env` reads across five files,
 * several of them inside `@Module` decorators — which means they ran at import
 * time, before any test could set them, and were invisible to anyone reading
 * the module's providers. Five production knobs (outbox batch size, lease and
 * prune interval; consumer attempts and backoff) had no environment path at
 * all, and `.env.example` documented a `DATABASE_URL` default pointing at a port
 * compose does not publish.
 *
 * Misconfiguration now fails at startup with the offending variable named,
 * rather than surfacing as a connection timeout in production.
 */

const port = z.coerce.number().int().positive();
const milliseconds = z.coerce.number().int().positive();
const count = z.coerce.number().int().positive();
const flag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const schema = z.object({
  PORT: port.default(3000),
  GLOBAL_PREFIX: z.string().default('api'),

  DATABASE_URL: z
    .string()
    .default('postgresql://pooleno:pooleno@localhost:5432/pooleno'),
  DATABASE_POOL_MAX: count.default(10),
  DATABASE_LOCK_TIMEOUT_MS: milliseconds.default(3_000),
  DATABASE_STATEMENT_TIMEOUT_MS: milliseconds.default(10_000),
  DATABASE_MIGRATIONS_DIR: z.string().default('src/adapters/database/migrations'),
  DATABASE_SEED_PATH: z.string().default('src/adapters/database/seed.sql'),
  SEED_DEV_DATA: flag,

  REDIS_URL: z.string().default('redis://localhost:6379'),
  WITHDRAWAL_RATE_LIMIT: count.default(10),
  WITHDRAWAL_RATE_LIMIT_WINDOW_SECONDS: count.default(60),

  ENABLE_MESSAGING: flag,
  KAFKA_BROKERS: z.string().default('localhost:9092'),
  KAFKA_TOPIC: z.string().default('withdrawal-execution-requested'),
  KAFKA_DLQ_TOPIC: z.string().optional(),
  KAFKA_CLIENT_ID: z.string().default('pooleno-withdrawal'),
  KAFKA_CONSUMER_GROUP: z.string().default('withdrawal-executors'),
  // Messages are keyed by withdrawalId, so one aggregate's lifecycle stays on
  // one partition however many there are. More than one buys parallelism
  // without weakening that.
  KAFKA_TOPIC_PARTITIONS: count.default(3),
  KAFKA_TOPIC_REPLICATION_FACTOR: count.default(1),

  OUTBOX_POLL_INTERVAL_MS: milliseconds.default(1_000),
  OUTBOX_RETENTION_MS: milliseconds.default(7 * 24 * 60 * 60 * 1000),
  OUTBOX_PRUNE_INTERVAL_MS: milliseconds.default(60 * 60 * 1000),
  OUTBOX_BATCH_SIZE: count.default(20),
  OUTBOX_LEASE_SECONDS: count.default(30),

  CONSUMER_MAX_ATTEMPTS: count.default(5),
  CONSUMER_BACKOFF_MS: milliseconds.default(250),

  WITHDRAWAL_PROCESSING_TIMEOUT_MS: milliseconds.default(15 * 60 * 1000),
  WITHDRAWAL_RECOVERY_INTERVAL_MS: milliseconds.default(60_000),
  WITHDRAWAL_RECOVERY_BATCH_SIZE: count.default(50),

  FAKE_PROVIDER_OUTCOME: z.enum(['SUCCESS', 'FAILED']).default('SUCCESS'),
});

export type AppConfig = Readonly<z.infer<typeof schema>> & {
  /** Defaults to `<topic>.dlq`, which is why it is derived rather than parsed. */
  readonly kafkaDlqTopic: string;
};

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.parse(env);
  return {
    ...parsed,
    kafkaDlqTopic: parsed.KAFKA_DLQ_TOPIC ?? `${parsed.KAFKA_TOPIC}.dlq`,
  };
}
