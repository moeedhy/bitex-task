import type { ReservationId } from '@bitex/platform';

/**
 * The two ways a held reservation can end. Which one applies is decided by the
 * domain event the Withdrawal emits, not by this port.
 */
export interface WalletSettlementPort {
  finalize(reservationId: ReservationId): Promise<void>;
  release(reservationId: ReservationId): Promise<void>;
}
