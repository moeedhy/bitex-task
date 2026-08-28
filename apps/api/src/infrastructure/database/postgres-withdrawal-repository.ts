import { Money, resolveAsset } from '@bitex/platform';
import { Withdrawal, WithdrawalNotFoundError } from '@bitex/withdrawal';
import type {
  WithdrawalRepository,
  WithdrawalSnapshot,
} from '@bitex/withdrawal';
import type { PostgresTransactionRunner } from './postgres-transaction-runner.js';

interface WithdrawalRow {
  id: string;
  user_id: string;
  asset: string;
  amount_atomic: string;
  destination_address: string;
  reservation_id: string;
  status: WithdrawalSnapshot['status'];
  transaction_reference: string | null;
  failure_reason: WithdrawalSnapshot['failureReason'] | null;
  created_at: Date;
  updated_at: Date;
}

const columns = `id, user_id, asset, amount_atomic, destination_address,
  reservation_id, status, transaction_reference, failure_reason,
  created_at, updated_at`;

export class PostgresWithdrawalRepository implements WithdrawalRepository {
  constructor(
    private readonly transaction: Pick<PostgresTransactionRunner, 'client'>,
  ) {}

  async add(withdrawal: Withdrawal): Promise<void> {
    const row = withdrawal.toSnapshot();
    await this.transaction.client().query(
      `INSERT INTO withdrawals
        (id, user_id, asset, amount_atomic, destination_address, reservation_id,
         status, transaction_reference, failure_reason, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      this.values(row),
    );
  }

  async getById(id: string): Promise<Withdrawal | null> {
    const result = await this.transaction
      .client()
      .query<WithdrawalRow>(
        `SELECT ${columns} FROM withdrawals WHERE id = $1`,
        [id],
      );
    return result.rowCount === 1 ? this.hydrate(result.rows[0]) : null;
  }

  async getForUpdate(id: string): Promise<Withdrawal> {
    const result = await this.transaction
      .client()
      .query<WithdrawalRow>(
        `SELECT ${columns} FROM withdrawals WHERE id = $1 FOR UPDATE`,
        [id],
      );
    if (result.rowCount !== 1) {
      throw new WithdrawalNotFoundError(id);
    }
    return this.hydrate(result.rows[0]);
  }

  async save(withdrawal: Withdrawal): Promise<void> {
    const row = withdrawal.toSnapshot();
    await this.transaction.client().query(
      `UPDATE withdrawals
       SET status = $2, transaction_reference = $3, failure_reason = $4,
           updated_at = $5
       WHERE id = $1`,
      [
        row.id,
        row.status,
        row.transactionReference ?? null,
        row.failureReason ?? null,
        row.updatedAt,
      ],
    );
  }

  private values(row: WithdrawalSnapshot): unknown[] {
    return [
      row.id,
      row.userId,
      row.asset.code,
      row.amount.toAtomicUnits().toString(),
      row.destinationAddress,
      row.reservationId,
      row.status,
      row.transactionReference ?? null,
      row.failureReason ?? null,
      row.createdAt,
      row.updatedAt,
    ];
  }

  private hydrate(row: WithdrawalRow): Withdrawal {
    const asset = resolveAsset(row.asset);
    return Withdrawal.restore({
      id: row.id,
      userId: row.user_id,
      asset,
      amount: Money.fromAtomicUnits(BigInt(row.amount_atomic), asset),
      destinationAddress: row.destination_address,
      reservationId: row.reservation_id,
      status: row.status,
      transactionReference: row.transaction_reference ?? undefined,
      failureReason: row.failure_reason ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}
