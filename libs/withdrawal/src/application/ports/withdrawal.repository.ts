import type { Withdrawal } from '../../domain/withdrawal.js';

export interface WithdrawalRepository {
  add(withdrawal: Withdrawal): Promise<void>;
  getById(id: string): Promise<Withdrawal | null>;
  getForUpdate(id: string): Promise<Withdrawal>;
  save(withdrawal: Withdrawal): Promise<void>;
}
