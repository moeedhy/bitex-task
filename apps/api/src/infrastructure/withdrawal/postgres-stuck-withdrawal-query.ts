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
}

/**
 * Claims stranded withdrawals inside the recovery transaction, so the scan and
 * the outbox writes it produces share one snapshot and one commit.
 *
 * This is a *claim*, not a plain read, and it is written as one statement for
 * two reasons the previous `SELECT … ORDER BY … LIMIT` got wrong:
 *
 * - `FOR UPDATE SKIP LOCKED` stops two replicas re-publishing the same
 *   withdrawal on the same tick. The outbox publisher already leases its rows
 *   this way; recovery had no equivalent.
 * - Touching `updated_at` re-arms the timeout. Nothing else moves it for a
 *   withdrawal that is genuinely wedged — `ExecuteWithdrawal` only writes it on
 *   the PENDING transition — so such a row stayed permanently eligible and was
 *   re-published every 60 seconds, forever, by every replica. Re-stamping it
 *   bounds that to one retry per timeout window.
 *
 * A permanently unresolvable withdrawal is still retried indefinitely, just
 * slowly. Bounding it properly needs an attempt counter, which needs a column.
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
      `UPDATE withdrawals
       SET updated_at = now()
       WHERE id IN (
         SELECT id FROM withdrawals
         WHERE status = 'PROCESSING' AND updated_at < $1
         ORDER BY updated_at
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       RETURNING id, user_id, asset, amount_atomic`,
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
      };
    });
  }
}
