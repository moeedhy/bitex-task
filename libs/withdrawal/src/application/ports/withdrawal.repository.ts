import type { WithdrawalId } from '@bitex/platform';
import type { Withdrawal } from '../../domain/withdrawal.js';

/**
 * Shared by RequestWithdrawal and ExecuteWithdrawal, which is why it lives in
 * `ports/` rather than inside a slice.
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
