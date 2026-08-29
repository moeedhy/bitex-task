import { Money, resolveAsset } from '@bitex/platform';
import type {
  StuckWithdrawal,
  StuckWithdrawalQueryPort,
} from '@bitex/withdrawal';
import type { PostgresTransactionRunner } from '../shared/postgres-transaction-runner.js';

interface StuckRow {
  id: string;
  user_id: string;
  asset: string;
  amount_atomic: string;
  destination_address: string;
}

/**
 * Reads inside the recovery transaction so the scan and the outbox writes it
 * produces share one snapshot and one commit.
 */
export class PostgresStuckWithdrawalQuery implements StuckWithdrawalQueryPort {
  constructor(
    private readonly transaction: Pick<PostgresTransactionRunner, 'client'>,
  ) {}

  async findProcessingSince(input: {
    threshold: Date;
    limit: number;
  }): Promise<StuckWithdrawal[]> {
    const result = await this.transaction.client().query<StuckRow>(
      `SELECT id, user_id, asset, amount_atomic, destination_address
       FROM withdrawals
       WHERE status = 'PROCESSING' AND updated_at < $1
       ORDER BY updated_at
       LIMIT $2`,
      [input.threshold, input.limit],
    );

    return result.rows.map((row) => {
      const asset = resolveAsset(row.asset);
      return {
        withdrawalId: row.id,
        userId: row.user_id,
        asset: row.asset,
        amount: Money.fromAtomicUnits(
          BigInt(row.amount_atomic),
          asset,
        ).toDecimalString(),
        destinationAddress: row.destination_address,
      };
    });
  }
}
