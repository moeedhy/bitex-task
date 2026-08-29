import type { Money, UserId, WithdrawalId } from '@bitex/platform';
import type { WithdrawalStatus } from '../../domain/withdrawal-status.js';

/**
 * `amount` carries its own `Asset`, so the command deliberately has no separate
 * asset field: a command whose asset disagrees with its amount cannot be
 * represented.
 */
export interface RequestWithdrawalCommand {
  idempotencyKey: string;
  userId: UserId;
  amount: Money;
  destinationAddress: string;
}

/**
 * What the workflow returns. Not the HTTP body and not the stored idempotent
 * response — those are separate types owned by the layers that persist and
 * serialise them, so this one can change without a data migration.
 */
export interface RequestWithdrawalResult {
  withdrawalId: WithdrawalId;
  status: WithdrawalStatus;
  asset: string;
  amount: string;
}
