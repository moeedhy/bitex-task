import { Money, resolveAsset, WithdrawalId } from '@bitex/platform';
import type { WithdrawalQueryPort, WithdrawalView } from '@bitex/withdrawal';
import type { Pool } from 'pg';

interface ViewRow {
  id: string;
  status: WithdrawalView['status'];
  asset: string;
  amount_atomic: string;
  transaction_reference: string | null;
  created_at: Date;
}

export class PostgresWithdrawalQuery implements WithdrawalQueryPort {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async getById(id: WithdrawalId): Promise<WithdrawalView | null> {
    const result = await this.pool.query<ViewRow>(
      `SELECT id, status, asset, amount_atomic, transaction_reference, created_at
       FROM withdrawals WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const asset = resolveAsset(row.asset);
    const amount = Money.fromAtomicUnits(
      BigInt(row.amount_atomic),
      asset,
    ).toDecimalString();
    return {
      withdrawalId: WithdrawalId.parse(row.id),
      status: row.status,
      asset: row.asset,
      amount,
      transactionReference: row.transaction_reference ?? undefined,
      createdAt: row.created_at.toISOString(),
    };
  }
}
