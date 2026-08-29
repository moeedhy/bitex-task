import { CodedError } from '@bitex/platform';
import type { QueryResult } from 'pg';

/**
 * An `UPDATE` that was expected to change exactly one row changed a different
 * number of them.
 *
 * Every aggregate mutation in this service runs inside a transaction that has
 * already taken `SELECT … FOR UPDATE` on the row it is about to write, so zero
 * affected rows is not a business outcome — it means the row vanished, the
 * identity is wrong, or the write went somewhere unexpected. Left unchecked, the
 * transaction commits happily and the divergence is silent: in `ReserveFunds`
 * the reservation row is inserted regardless, so a no-op wallet `UPDATE` commits
 * a reservation whose `reserved_atomic` was never incremented. That is money
 * that appears reserved to the reservation table and available to the wallet.
 *
 * Failing loudly aborts the transaction and rolls the whole thing back, which is
 * the only safe response to a write that did not land.
 */
export class StaleWriteError extends CodedError {
  readonly code = 'STALE_WRITE' as const;

  constructor(
    readonly relation: string,
    readonly identity: string,
    readonly affected: number,
  ) {
    super(
      `Expected to update exactly one "${relation}" row for "${identity}", but ${affected} were affected.`,
    );
  }
}

export function requireSingleRow(
  result: Pick<QueryResult, 'rowCount'>,
  relation: string,
  identity: string,
): void {
  if (result.rowCount !== 1) {
    throw new StaleWriteError(relation, identity, result.rowCount ?? 0);
  }
}
