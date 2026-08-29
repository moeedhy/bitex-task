import type {
  Money,
  ReservationId,
  UserId,
  WithdrawalId,
} from '@bitex/platform';

/**
 * Consumer-owned: declared here, by the context that needs funds held, and
 * satisfied at the composition root by a Wallet use case. Withdrawal never sees
 * a wallet aggregate or repository, and Wallet never learns that withdrawals
 * exist.
 */
export interface WalletReservationPort {
  reserve(input: {
    withdrawalId: WithdrawalId;
    userId: UserId;
    amount: Money;
  }): Promise<{ reservationId: ReservationId }>;
}
