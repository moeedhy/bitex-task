import type { WalletRepository } from './wallet.repository.js';

export class ReleaseReservation {
  constructor(private readonly wallets: WalletRepository) {}

  async execute(reservationId: string): Promise<void> {
    const wallet = await this.wallets.getByReservationForUpdate(reservationId);
    wallet.releaseReservation(reservationId);
    await this.wallets.save(wallet);
  }
}
