import { assertNever } from '@bitex/platform';
import type { WalletReservationRepository } from '../ports/wallet-reservation.repository.js';
import type { WalletRepository } from '../ports/wallet.repository.js';
import type { SettleReservationCommand } from './settle-reservation.contract.js';

/**
 * Ends a held reservation, one way or the other.
 *
 * This replaces `FinalizeReservation` and `ReleaseReservation`, which were the
 * same seven lines twice — same collaborators, same lock order, same shape,
 * differing only in which pair of aggregate methods they called. The
 * composition root then immediately re-fused them behind a single adapter, so
 * the split bought nothing and cost a reader two files to see one rule.
 *
 * Locks are taken reservation → wallet, matching the hierarchy recorded in
 * DECISIONS.md: every path that touches both takes them in that order, so two
 * settlements of different reservations against the same wallet cannot deadlock.
 */
export class SettleReservation {
  constructor(
    private readonly wallets: WalletRepository,
    private readonly reservations: WalletReservationRepository,
  ) {}

  async execute(command: SettleReservationCommand): Promise<void> {
    const reservation = await this.reservations.getForUpdate(
      command.reservationId,
    );
    const wallet = await this.wallets.getByIdForUpdate(reservation.walletId);

    switch (command.outcome) {
      case 'FINALIZE':
        reservation.finalize();
        wallet.captureReserved(reservation.amount);
        break;
      case 'RELEASE':
        reservation.release();
        wallet.releaseReserved(reservation.amount);
        break;
      default:
        assertNever(command.outcome);
    }

    await this.wallets.save(wallet);
    await this.reservations.save(reservation);
  }
}
