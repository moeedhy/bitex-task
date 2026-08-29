import type { ExecutionRequest, ExecutionResult, WithdrawalProvider } from '@bitex/withdrawal';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Parsing lives here, not in the port: validating persisted JSON is this
 * adapter's problem, and the application only needs the shape.
 */
const ExecutionResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('SUCCESS'),
    transactionReference: z.string().trim().min(1).max(256),
  }),
  z.strictObject({
    status: z.literal('FAILED'),
    reason: z.literal('PROVIDER_ERROR'),
  }),
]);

interface ProviderRow {
  result: unknown;
}

/**
 * Stands in for a real provider, and models the property that makes the whole
 * retry design safe: one durable result per `withdrawalId`.
 *
 * The first call decides the outcome and persists it; every repeat returns that
 * same stored result. Without this, redelivery after an unresolved call could
 * execute a second transfer.
 */
export class PostgresFakeWithdrawalProvider implements WithdrawalProvider {
  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    private readonly shouldFail: (request: ExecutionRequest) => boolean = () =>
      false,
    private readonly transactionReference: () => string = () =>
      `tx-${randomUUID()}`,
  ) {}

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const result: ExecutionResult = this.shouldFail(request)
      ? { status: 'FAILED', reason: 'PROVIDER_ERROR' }
      : {
          status: 'SUCCESS',
          transactionReference: this.transactionReference(),
        };
    const inserted = await this.pool.query<ProviderRow>(
      `INSERT INTO fake_provider_executions(withdrawal_id, result)
       VALUES ($1, $2)
       ON CONFLICT (withdrawal_id) DO NOTHING
       RETURNING result`,
      [request.withdrawalId, JSON.stringify(result)],
    );
    const insertedRow = inserted.rows[0];
    if (insertedRow) {
      return ExecutionResultSchema.parse(insertedRow.result);
    }
    const existing = await this.pool.query<ProviderRow>(
      'SELECT result FROM fake_provider_executions WHERE withdrawal_id = $1',
      [request.withdrawalId],
    );
    const existingRow = existing.rows[0];
    if (!existingRow) {
      throw new Error(
        `Provider execution for withdrawal "${request.withdrawalId}" vanished between insert and read.`,
      );
    }
    return ExecutionResultSchema.parse(existingRow.result);
  }
}
