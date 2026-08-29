import type {
  Money,
  ReservationId,
  UserId,
  WithdrawalId,
} from '@bitex/platform';

/**
 * The asset is read from `amount` rather than passed alongside it, so the
 * wallet that is locked and the money that is reserved cannot disagree.
 */
export interface ReserveFundsCommand {
  withdrawalId: WithdrawalId;
  userId: UserId;
  amount: Money;
}

export interface ReserveFundsResult {
  reservationId: ReservationId;
}
