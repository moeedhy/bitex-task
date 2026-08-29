import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { SchemaMigrator } from './schema-migrator.js';

const describePostgres = process.env.TEST_DATABASE_URL
  ? describe
  : describe.skip;

describePostgres('SchemaMigrator', () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const migrationsDir = join(__dirname, '../database/migrations');
  const migrator = new SchemaMigrator(migrationsDir);

  /**
   * Read from disk rather than listed here. What matters is that *every* file
   * is applied, in filename order, and recorded — not which four exist today.
   * A hardcoded list makes adding a migration a two-file change and, worse,
   * turns a forgotten update into a failing test that says nothing about the
   * property being protected.
   */
  const expectedMigrations = async () =>
    (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  beforeAll(async () => {
    const database = await pool.query<{ current_database: string }>(
      'SELECT current_database()',
    );
    if (!database.rows[0]?.current_database.endsWith('_test')) {
      throw new Error('Integration tests require a dedicated *_test database.');
    }
  });

  beforeEach(async () => {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  });

  afterAll(async () => pool.end());

  it('applies every migration to an empty database, in filename order', async () => {
    const expected = await expectedMigrations();

    const applied = await migrator.run(pool);

    expect(applied).toEqual(expected);
    expect(applied[0]).toBe('001_initial.sql');
    await expect(
      pool.query('SELECT count(*)::int AS total FROM schema_migrations'),
    ).resolves.toMatchObject({ rows: [{ total: expected.length }] });
  });

  it('is a no-op on a database that is already current', async () => {
    await migrator.run(pool);

    await expect(migrator.run(pool)).resolves.toEqual([]);
  });

  it('brings a database built before tracking existed up to date', async () => {
    // Exactly the situation a long-lived volume ends up in: the Postgres
    // entrypoint applied the migrations that existed at the time and recorded
    // nothing, so later migrations were never run.
    await pool.query(
      await readFile(
        join(__dirname, '../database/migrations/001_initial.sql'),
        'utf8',
      ),
    );
    await expect(
      pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'wallet_reservations' AND column_name = 'asset'`,
      ),
    ).resolves.toMatchObject({ rowCount: 0 });

    const applied = await migrator.run(pool);

    // Every file, including 001 -- which is why each migration has to stay
    // idempotent: on an untracked database the migrator has no way to know
    // 001 already ran, so it runs it again.
    expect(applied).toEqual(await expectedMigrations());
    await expect(
      pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'wallet_reservations' AND column_name = 'asset'`,
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });
});
