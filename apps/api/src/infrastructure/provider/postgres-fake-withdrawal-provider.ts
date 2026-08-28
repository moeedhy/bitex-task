import { ExecutionResultSchema, WithdrawalProvider } from '@bitex/withdrawal';
import type { ExecutionRequest, ExecutionResult } from '@bitex/withdrawal';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

interface ProviderRow {
  result: unknown;
}

export class PostgresFakeWithdrawalProvider extends WithdrawalProvider {
  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    private readonly shouldFail: (request: ExecutionRequest) => boolean = () =>
      false,
    private readonly transactionReference: () => string = () =>
      `tx-${randomUUID()}`,
  ) {
    super();
  }

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
    if (inserted.rowCount === 1) {
      return ExecutionResultSchema.parse(inserted.rows[0].result);
    }
    const existing = await this.pool.query<ProviderRow>(
      'SELECT result FROM fake_provider_executions WHERE withdrawal_id = $1',
      [request.withdrawalId],
    );
    return ExecutionResultSchema.parse(existing.rows[0].result);
  }
}
