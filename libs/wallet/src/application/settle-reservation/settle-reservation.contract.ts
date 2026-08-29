import type { ReservationId } from '@bitex/platform';

/**
 * The two ways a held reservation ends.
 *
 * `FINALIZE` captures the funds — the money left the exchange. `RELEASE`
 * returns them to available balance. Naming the outcome rather than splitting
 * into two use cases keeps the pair visible: every reservation must eventually
 * receive exactly one of these, and reading one file is enough to see both.
 */
export const RESERVATION_OUTCOMES = ['FINALIZE', 'RELEASE'] as const;

export type ReservationOutcome = (typeof RESERVATION_OUTCOMES)[number];

export interface SettleReservationCommand {
  reservationId: ReservationId;
  outcome: ReservationOutcome;
}
