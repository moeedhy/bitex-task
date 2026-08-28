import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Assets, Money } from '@bitex/platform';
import {
  FinalizeReservation,
  ReleaseReservation,
  ReserveFunds,
} from '@bitex/wallet';
import { ExecuteWithdrawal, RequestWithdrawal } from '@bitex/withdrawal';
import { PostgresTransactionRunner } from './postgres-transaction-runner.js';
import { PostgresWalletRepository } from './postgres-wallet-repository.js';
import { PostgresWithdrawalRepository } from './postgres-withdrawal-repository.js';
import { PostgresWithdrawalIdempotency } from './postgres-idempotency.js';
import { PostgresOutbox } from './postgres-outbox.js';
import { PostgresProcessedEvents } from './postgres-processed-events.js';
import { PostgresFakeWithdrawalProvider } from '../provider/postgres-fake-withdrawal-provider.js';

const describePostgres = process.env.TEST_DATABASE_URL
  ? describe
  : describe.skip;

describePostgres('PostgreSQL withdrawal transaction', () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let useCase: RequestWithdrawal;
  let transaction: PostgresTransactionRunner;
  let walletRepository: PostgresWalletRepository;
  let withdrawalRepository: PostgresWithdrawalRepository;

  beforeAll(async () => {
    const migration = await readFile(
      join(
        process.cwd(),
        'src/infrastructure/database/migrations/001_initial.sql',
      ),
      'utf8',
    );
    await pool.query(migration);
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
    withdrawalRepository = new PostgresWithdrawalRepository(transaction);
    useCase = new RequestWithdrawal({
      transactionRunner: transaction,
      idempotency: new PostgresWithdrawalIdempotency(transaction),
      walletReservation: {
        reserve: (input) =>
          new ReserveFunds(walletRepository, { next: randomUUID }).execute(
            input,
          ),
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
        fingerprint: key,
        userId: 'user-123',
        asset: Assets.USDT,
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
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
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
      fingerprint: 'same-fingerprint',
      userId: 'user-123',
      asset: Assets.USDT,
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

  function request(idempotencyKey: string, amount: string) {
    return useCase.execute({
      idempotencyKey,
      fingerprint: `${idempotencyKey}-${amount}`,
      userId: 'user-123',
      asset: Assets.USDT,
      amount: Money.parse(amount, Assets.USDT),
      destinationAddress: 'TXYZ123456789',
    });
  }

  function executionUseCase(shouldFail: boolean): ExecuteWithdrawal {
    const finalize = new FinalizeReservation(walletRepository);
    const release = new ReleaseReservation(walletRepository);
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
