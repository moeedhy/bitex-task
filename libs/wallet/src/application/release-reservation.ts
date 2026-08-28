import type { WalletReservationRepository } from './wallet-reservation.repository.js';
import type { WalletRepository } from './wallet.repository.js';

export class ReleaseReservation {
  constructor(
    private readonly wallets: WalletRepository,
    private readonly reservations: WalletReservationRepository,
  ) {}

  async execute(reservationId: string): Promise<void> {
    const reservation = await this.reservations.getForUpdate(reservationId);
    const wallet = await this.wallets.getByIdForUpdate(reservation.walletId);
    reservation.release();
    wallet.releaseReserved(reservation.amount);
    await this.wallets.save(wallet);
    await this.reservations.save(reservation);
  }
}
