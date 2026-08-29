import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Assets, Money } from '@bitex/platform';
import {
  FinalizeReservation,
  InsufficientAvailableBalanceError,
  ReleaseReservation,
  ReserveFunds,
  WalletAccount,
} from '@bitex/wallet';
import {
  ExecuteWithdrawal,
  IdempotencyKeyConflictError,
  RecoverStuckWithdrawals,
  RequestWithdrawal,
} from '@bitex/withdrawal';
import { PostgresTransactionRunner } from '../shared/postgres-transaction-runner.js';
import { SchemaMigrator } from '../shared/schema-migrator.js';
import { PostgresWalletRepository } from '../wallet/postgres-wallet-repository.js';
import { PostgresWalletReservationRepository } from '../wallet/postgres-wallet-reservation-repository.js';
import { PostgresWithdrawalRepository } from './postgres-withdrawal-repository.js';
import { PostgresWithdrawalIdempotency } from './postgres-idempotency.js';
import { PostgresOutbox } from '../shared/postgres-outbox.js';
import { PostgresProcessedEvents } from './postgres-processed-events.js';
import { PostgresStuckWithdrawalQuery } from './postgres-stuck-withdrawal-query.js';
import { PostgresFakeWithdrawalProvider } from './postgres-fake-withdrawal-provider.js';

const describePostgres = process.env.TEST_DATABASE_URL
  ? describe
  : describe.skip;

describePostgres('PostgreSQL withdrawal transaction', () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let useCase: RequestWithdrawal;
  let transaction: PostgresTransactionRunner;
  let walletRepository: PostgresWalletRepository;
  let walletReservationRepository: PostgresWalletReservationRepository;
  let withdrawalRepository: PostgresWithdrawalRepository;

  beforeAll(async () => {
    const database = await pool.query<{ current_database: string }>(
      'SELECT current_database()',
    );
    if (!database.rows[0]?.current_database.endsWith('_test')) {
      throw new Error('Integration tests require a dedicated *_test database.');
    }
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await new SchemaMigrator(
      join(__dirname, '../database/migrations'),
    ).run(pool);
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE fake_provider_executions, processed_events, outbox_events,
        idempotency_records, withdrawals, wallet_reservations, wallets CASCADE`,
    );
    await pool.query(
      `INSERT INTO wallets(id, user_id, asset, balance_atomic, reserved_atomic)
       VALUES ('wallet-1', 'user-123', 'USDT', 100000000, 0)`,
    );
    transaction = new PostgresTransactionRunner(pool);
    walletRepository = new PostgresWalletRepository(transaction);
    walletReservationRepository = new PostgresWalletReservationRepository(
      transaction,
    );
    withdrawalRepository = new PostgresWithdrawalRepository(transaction);
    useCase = new RequestWithdrawal({
      transactionRunner: transaction,
      idempotency: new PostgresWithdrawalIdempotency(transaction),
      walletReservation: {
        reserve: (input) =>
          new ReserveFunds(walletRepository, walletReservationRepository, {
            next: randomUUID,
          }).execute(input),
      },
      withdrawals: withdrawalRepository,
      outbox: new PostgresOutbox(transaction),
      withdrawalIdGenerator: { next: randomUUID },
      eventIdGenerator: { next: randomUUID },
      clock: { now: () => new Date('2026-08-15T10:00:00.000Z') },
    });
  });

  afterAll(async () => pool.end());

  it('allows exactly one of two concurrent 80 USDT withdrawals from 100 USDT', async () => {
    const execute = (key: string) =>
      useCase.execute({
        idempotencyKey: key,
        userId: 'user-123',
        amount: Money.parse('80', Assets.USDT),
        destinationAddress: 'TXYZ123456789',
      });

    const results = await Promise.allSettled([
      execute('key-a'),
      execute('key-b'),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    // Asserting *why* the loser lost, not just that it lost. Without this a
    // `lock_timeout` expiry on the contended wallet row would satisfy the count
    // assertions identically, and the test would keep passing while proving
    // nothing about the balance invariant it exists to protect.
    expect(rejected[0]?.reason).toBeInstanceOf(
      InsufficientAvailableBalanceError,
    );
    const wallet = await pool.query(
      'SELECT reserved_atomic FROM wallets WHERE id = $1',
      ['wallet-1'],
    );
    expect(wallet.rows[0].reserved_atomic).toBe('80000000');
    await expect(
      pool.query('SELECT id FROM withdrawals'),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      pool.query('SELECT id FROM outbox_events'),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it('coalesces concurrent identical idempotent requests into one logical result', async () => {
    const command = {
      idempotencyKey: 'same-key',
      userId: 'user-123',
      amount: Money.parse('10', Assets.USDT),
      destinationAddress: 'TXYZ123456789',
    };

    const [first, second] = await Promise.all([
      useCase.execute(command),
      useCase.execute(command),
    ]);

    expect(second).toEqual(first);
    await expect(
      pool.query('SELECT id FROM withdrawals'),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      pool.query('SELECT id FROM wallet_reservations'),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      pool.query('SELECT id FROM outbox_events'),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it('finalizes the reservation once after successful provider execution', async () => {
    const requested = await request('success-key', '25');
    const execute = executionUseCase(false);

    await execute.execute({
      eventId: 'success-event',
      withdrawalId: requested.withdrawalId,
    });
    await execute.execute({
      eventId: 'success-event',
      withdrawalId: requested.withdrawalId,
    });

    await expect(persistedState(requested.withdrawalId)).resolves.toEqual({
      balance_atomic: '75000000',
      reserved_atomic: '0',
      reservation_status: 'FINALIZED',
      withdrawal_status: 'COMPLETED',
      transaction_reference: 'tx-test',
      provider_executions: 1,
      processed_events: 1,
    });
  });

  it('releases the reservation after failed provider execution', async () => {
    const requested = await request('failure-key', '25');

    await executionUseCase(true).execute({
      eventId: 'failure-event',
      withdrawalId: requested.withdrawalId,
    });

    await expect(persistedState(requested.withdrawalId)).resolves.toEqual({
      balance_atomic: '100000000',
      reserved_atomic: '0',
      reservation_status: 'RELEASED',
      withdrawal_status: 'FAILED',
      transaction_reference: null,
      provider_executions: 1,
      processed_events: 1,
    });
  });

  it('rejects a key reused with a different payload and keeps the original', async () => {
    const original = await request('reused-key', '10');

    await expect(request('reused-key', '20')).rejects.toThrow(
      IdempotencyKeyConflictError,
    );

    await expect(
      pool.query('SELECT id FROM withdrawals'),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      pool.query('SELECT reserved_atomic FROM wallets WHERE id = $1', [
        'wallet-1',
      ]),
    ).resolves.toMatchObject({ rows: [{ reserved_atomic: '10000000' }] });
    await expect(request('reused-key', '10')).resolves.toEqual(original);
  });

  it('re-publishes execution intent for a withdrawal stranded in PROCESSING', async () => {
    const requested = await request('stuck-key', '30');
    await pool.query(
      `UPDATE withdrawals
       SET status = 'PROCESSING', updated_at = now() - interval '1 hour'
       WHERE id = $1`,
      [requested.withdrawalId],
    );

    const recovered = await recoverStuck();

    expect(recovered.rescheduled).toEqual([requested.withdrawalId]);
    const events = await pool.query(
      'SELECT id, payload FROM outbox_events WHERE aggregate_id = $1',
      [requested.withdrawalId],
    );
    expect(events.rowCount).toBe(2);
    expect(new Set(events.rows.map((row) => row.id)).size).toBe(2);
    expect(events.rows[1].payload).toMatchObject({
      withdrawalId: requested.withdrawalId,
      amount: '30',
    });
  });

  /**
   * Before the `rowCount` guard, an `UPDATE … WHERE id = $1` that matched no row
   * committed silently. `ReserveFunds` inserts the reservation regardless, so
   * the transaction would commit a reservation against a wallet whose
   * `reserved_atomic` was never incremented — funds reserved according to one
   * table and available according to the other, with no error anywhere.
   */
  /**
   * The amplification regression. Recovery never moved `updated_at`, and nothing
   * else does for a withdrawal wedged in PROCESSING, so the row stayed eligible
   * on every tick: one re-published event per replica per 60s, indefinitely.
   */
  it('does not re-publish the same stranded withdrawal on the next cycle', async () => {
    const requested = await request('rearm-key', '30');
    await pool.query(
      `UPDATE withdrawals
       SET status = 'PROCESSING', updated_at = now() - interval '1 hour'
       WHERE id = $1`,
      [requested.withdrawalId],
    );

    const first = await recoverStuck();
    const second = await recoverStuck();

    expect(first.rescheduled).toEqual([requested.withdrawalId]);
    expect(second.rescheduled).toEqual([]);
    await expect(
      pool.query('SELECT id FROM outbox_events WHERE aggregate_id = $1', [
        requested.withdrawalId,
      ]),
    ).resolves.toMatchObject({ rowCount: 2 });
  });

  it('refuses to commit a wallet update that matched no row', async () => {
    // A wallet the database has never seen. Saving it must fail rather than
    // report success on an UPDATE that touched nothing. Deleting the real row
    // concurrently would be a more literal reproduction but would simply
    // deadlock against the transaction's own `FOR UPDATE` lock.
    const orphan = WalletAccount.reconstitute({
      id: randomUUID(),
      userId: 'user-123',
      asset: Assets.USDT,
      balance: Money.parse('100', Assets.USDT),
      reservedBalance: Money.zero(Assets.USDT),
    });

    await expect(
      transaction.run(() => walletRepository.save(orphan)),
    ).rejects.toMatchObject({ code: 'STALE_WRITE' });

    // The guard aborts the transaction, so nothing partial is left behind.
    await expect(
      pool.query('SELECT reserved_atomic FROM wallets WHERE id = $1', [
        'wallet-1',
      ]),
    ).resolves.toMatchObject({ rows: [{ reserved_atomic: '0' }] });
  });

  function recoverStuck() {
    return new RecoverStuckWithdrawals({
      transactionRunner: transaction,
      stuckWithdrawals: new PostgresStuckWithdrawalQuery(transaction),
      outbox: new PostgresOutbox(transaction),
      eventIdGenerator: { next: randomUUID },
      clock: { now: () => new Date() },
      processingTimeoutMs: 15 * 60 * 1000,
      batchSize: 50,
    }).execute();
  }

  function request(idempotencyKey: string, amount: string) {
    return useCase.execute({
      idempotencyKey,
      userId: 'user-123',
      amount: Money.parse(amount, Assets.USDT),
      destinationAddress: 'TXYZ123456789',
    });
  }

  function executionUseCase(shouldFail: boolean): ExecuteWithdrawal {
    const finalize = new FinalizeReservation(
      walletRepository,
      walletReservationRepository,
    );
    const release = new ReleaseReservation(
      walletRepository,
      walletReservationRepository,
    );
    return new ExecuteWithdrawal({
      transactionRunner: transaction,
      withdrawals: withdrawalRepository,
      processedEvents: new PostgresProcessedEvents(transaction),
      walletSettlement: {
        finalize: (reservationId) => finalize.execute(reservationId),
        release: (reservationId) => release.execute(reservationId),
      },
      provider: new PostgresFakeWithdrawalProvider(
        pool,
        () => shouldFail,
        () => 'tx-test',
      ),
      clock: { now: () => new Date('2026-08-15T10:01:00.000Z') },
    });
  }

  async function persistedState(withdrawalId: string) {
    const result = await pool.query(
      `SELECT w.balance_atomic, w.reserved_atomic,
              r.status AS reservation_status,
              wd.status AS withdrawal_status,
              wd.transaction_reference,
              (SELECT count(*)::int FROM fake_provider_executions) AS provider_executions,
              (SELECT count(*)::int FROM processed_events) AS processed_events
       FROM wallets w
       JOIN wallet_reservations r ON r.wallet_id = w.id
       JOIN withdrawals wd ON wd.reservation_id = r.id
       WHERE wd.id = $1`,
      [withdrawalId],
    );
    return result.rows[0];
  }
});
