import type { IdGenerator } from '@bitex/platform';
import { WalletReservation } from '../../domain/wallet-reservation.js';
import type { WalletReservationRepository } from '../ports/wallet-reservation.repository.js';
import type { WalletRepository } from '../ports/wallet.repository.js';
import type {
  ReserveFundsCommand,
  ReserveFundsResult,
} from './reserve-funds.contract.js';

export class ReserveFunds {
  constructor(
    private readonly wallets: WalletRepository,
    private readonly reservations: WalletReservationRepository,
    private readonly reservationIds: IdGenerator<'ReservationId'>,
  ) {}

  /**
   * Participates in the caller's transaction; it never opens its own. The
   * repositories fail fast when no transaction is bound, so a caller that
   * forgets the boundary loses the row lock loudly rather than silently.
   *
   * Locks are taken wallet → reservation. The reservation row is brand new here
   * so nothing contends on it, but the order still matches the hierarchy in
   * DECISIONS.md rather than relying on that accident.
   */
  async execute(command: ReserveFundsCommand): Promise<ReserveFundsResult> {
    const wallet = await this.wallets.getForUpdate(
      command.userId,
      command.amount.asset,
    );
    const reservationId = this.reservationIds.next();
    wallet.reserve(command.amount);
    const reservation = WalletReservation.open({
      id: reservationId,
      walletId: wallet.id,
      withdrawalId: command.withdrawalId,
      amount: command.amount,
    });
    await this.wallets.save(wallet);
    await this.reservations.add(reservation);
    return { reservationId };
  }
}
