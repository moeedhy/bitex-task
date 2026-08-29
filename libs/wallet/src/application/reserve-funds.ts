import type { IdGenerator, Money } from '@bitex/platform';
import { WalletReservation } from '../domain/wallet-reservation.js';
import type { WalletReservationRepository } from './wallet-reservation.repository.js';
import type { WalletRepository } from './wallet.repository.js';

export class ReserveFunds {
  constructor(
    private readonly wallets: WalletRepository,
    private readonly reservations: WalletReservationRepository,
    private readonly reservationIds: IdGenerator,
  ) {}

  /**
   * Participates in the caller's transaction; it never opens its own. The
   * repositories fail fast when no transaction is bound, so a caller that
   * forgets the boundary loses the row lock loudly rather than silently.
   *
   * The asset is read from `amount` rather than passed alongside it, so the
   * wallet that is locked and the money that is reserved cannot disagree.
   */
  async execute(input: {
    withdrawalId: string;
    userId: string;
    amount: Money;
  }): Promise<{ reservationId: string }> {
    const wallet = await this.wallets.getForUpdate(
      input.userId,
      input.amount.asset,
    );
    const reservationId = this.reservationIds.next();
    wallet.reserve(input.amount);
    const reservation = WalletReservation.open({
      id: reservationId,
      walletId: wallet.id,
      withdrawalId: input.withdrawalId,
      amount: input.amount,
    });
    await this.wallets.save(wallet);
    await this.reservations.add(reservation);
    return { reservationId };
  }
}
