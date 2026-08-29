import { CodedError } from '@bitex/platform';
import type {
  IdempotencyClaim,
  RequestWithdrawalResult,
  WithdrawalIdempotencyPort,
} from '@bitex/withdrawal';
import type { TransactionalClient } from '../shared/transactional-client.js';

interface IdempotencyRow {
  request_fingerprint: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  response_payload: RequestWithdrawalResult | null;
}

/**
 * A committed record that is not COMPLETED, or a key that vanished between the
 * conflicting insert and the read.
 *
 * Neither is reachable while claim and completion share one transaction: an
 * abandoned claim rolls back with the workflow, so `IN_PROGRESS` is only ever
 * visible inside the transaction that wrote it. This is a data-integrity
 * alarm, not a business outcome, so it is not mapped to a 4xx response.
 */
export class CorruptIdempotencyRecordError extends CodedError {
  readonly code = 'CORRUPT_IDEMPOTENCY_RECORD' as const;

  constructor(readonly idempotencyKey: string) {
    super(
      `Idempotency record for key "${idempotencyKey}" is present but not completed.`,
    );
  }
}

export class PostgresWithdrawalIdempotency
  implements WithdrawalIdempotencyPort
{
  constructor(
    private readonly transaction: TransactionalClient,
  ) {}

  /**
   * A concurrent duplicate blocks on the unique index until the first
   * transaction resolves, then reads its committed outcome. That serialisation
   * is what makes "same key twice at the same moment" produce one withdrawal
   * and one replay rather than a race.
   */
  async claim(input: {
    operation: 'REQUEST_WITHDRAWAL';
    key: string;
    fingerprint: string;
  }): Promise<IdempotencyClaim> {
    const client = this.transaction.client();
    const inserted = await client.query(
      `INSERT INTO idempotency_records
        (operation, idempotency_key, request_fingerprint, status)
       VALUES ($1, $2, $3, 'IN_PROGRESS')
       ON CONFLICT (operation, idempotency_key) DO NOTHING
       RETURNING idempotency_key`,
      [input.operation, input.key, input.fingerprint],
    );
    if (inserted.rowCount === 1) {
      return { kind: 'CLAIMED' };
    }

    // Deliberately an unlocked read.
    //
    // Reaching this line means the INSERT above conflicted, and `ON CONFLICT DO
    // NOTHING` already blocked on the unique index until the claiming
    // transaction resolved — so the row we are about to read is committed, and
    // a COMPLETED record is never written again. There is nothing left to
    // serialise against.
    //
    // The previous `FOR UPDATE` held that row for the whole outer transaction,
    // so a client retry-storm on one key queued every duplicate behind a 3s
    // `lock_timeout` and turned cheap replays into `55P03` failures — the exact
    // load this table exists to absorb.
    const existing = await client.query<IdempotencyRow>(
      `SELECT request_fingerprint, status, response_payload
       FROM idempotency_records
       WHERE operation = $1 AND idempotency_key = $2`,
      [input.operation, input.key],
    );
    const row = existing.rows[0];
    if (!row) {
      throw new CorruptIdempotencyRecordError(input.key);
    }
    if (row.request_fingerprint !== input.fingerprint) {
      return { kind: 'CONFLICT' };
    }
    if (row.status !== 'COMPLETED' || !row.response_payload) {
      throw new CorruptIdempotencyRecordError(input.key);
    }
    // Rebuilt field by field rather than returned as stored: `jsonb` does not
    // preserve key order, so echoing the raw column would make a replay
    // logically identical but byte-different from the original response.
    const stored = row.response_payload;
    return {
      kind: 'REPLAY',
      result: {
        withdrawalId: stored.withdrawalId,
        status: stored.status,
        asset: stored.asset,
        amount: stored.amount,
      },
    };
  }

  async complete(key: string, result: RequestWithdrawalResult): Promise<void> {
    const updated = await this.transaction.client().query(
      `UPDATE idempotency_records
       SET status = 'COMPLETED', withdrawal_id = $2, response_payload = $3,
           completed_at = now()
       WHERE operation = 'REQUEST_WITHDRAWAL' AND idempotency_key = $1`,
      [key, result.withdrawalId, JSON.stringify(result)],
    );
    if (updated.rowCount !== 1) {
      // The claim this transaction wrote must still be here. If it is not, the
      // transaction would otherwise commit a record stuck at IN_PROGRESS and
      // permanently burn the key.
      throw new CorruptIdempotencyRecordError(key);
    }
  }
}
