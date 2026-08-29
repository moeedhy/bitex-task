import type { WithdrawalId } from '@bitex/platform';
import type { Withdrawal } from '../../domain/withdrawal.js';

/**
 * Aggregate persistence. The adapter implements all of it; the use cases depend
 * on the narrow views below.
 *
 * `getForUpdate` names the intent — obtain this aggregate for protected
 * mutation — without naming the mechanism. Reads that do not mutate use the
 * query port instead, so they never take a row lock.
 */
export interface WithdrawalRepository {
  add(withdrawal: Withdrawal): Promise<void>;
  getForUpdate(id: WithdrawalId): Promise<Withdrawal>;
  save(withdrawal: Withdrawal): Promise<void>;
}

/**
 * What `RequestWithdrawal` needs: somewhere to put a new aggregate.
 *
 * Derived from the repository rather than restated, so one change to a
 * signature reaches every view of it. The split is what removes the
 * `throw new Error('not used')` stubs from the test doubles — a fake forced to
 * implement methods the subject never calls is a fake that stops describing
 * the dependency.
 */
export type WithdrawalAppender = Pick<WithdrawalRepository, 'add'>;

/** What `ExecuteWithdrawal` needs: a locked read and a write-back. */
export type WithdrawalMutator = Pick<
  WithdrawalRepository,
  'getForUpdate' | 'save'
>;
