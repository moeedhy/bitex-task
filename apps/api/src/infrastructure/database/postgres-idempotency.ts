import type {
  RequestWithdrawalResult,
  WithdrawalIdempotencyPort,
} from '@bitex/withdrawal';
import type { PostgresTransactionRunner } from './postgres-transaction-runner.js';

interface IdempotencyRow {
  request_fingerprint: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  response_payload: RequestWithdrawalResult | null;
}

export class IdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT' as const;
  constructor() {
    super('The Idempotency-Key was already used with a different request.');
    this.name = 'IdempotencyConflictError';
  }
}

export class IdempotencyInProgressError extends Error {
  readonly code = 'IDEMPOTENCY_IN_PROGRESS' as const;
  constructor() {
    super('The idempotent operation is still in progress.');
    this.name = 'IdempotencyInProgressError';
  }
}

export class PostgresWithdrawalIdempotency
  implements WithdrawalIdempotencyPort
{
  constructor(
    private readonly transaction: Pick<PostgresTransactionRunner, 'client'>,
  ) {}

  async claim(input: {
    operation: 'REQUEST_WITHDRAWAL';
    key: string;
    fingerprint: string;
  }): Promise<
    { kind: 'CLAIMED' } | { kind: 'REPLAY'; result: RequestWithdrawalResult }
  > {
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

    const existing = await client.query<IdempotencyRow>(
      `SELECT request_fingerprint, status, response_payload
       FROM idempotency_records
       WHERE operation = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [input.operation, input.key],
    );
    const row = existing.rows[0];
    if (row.request_fingerprint !== input.fingerprint) {
      throw new IdempotencyConflictError();
    }
    if (row.status !== 'COMPLETED' || !row.response_payload) {
      throw new IdempotencyInProgressError();
    }
    return { kind: 'REPLAY', result: row.response_payload };
  }

  async complete(key: string, result: RequestWithdrawalResult): Promise<void> {
    await this.transaction.client().query(
      `UPDATE idempotency_records
       SET status = 'COMPLETED', withdrawal_id = $2, response_payload = $3,
           completed_at = now()
       WHERE operation = 'REQUEST_WITHDRAWAL' AND idempotency_key = $1`,
      [key, result.withdrawalId, JSON.stringify(result)],
    );
  }
}
