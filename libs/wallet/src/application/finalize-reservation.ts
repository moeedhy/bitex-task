import type { WalletRepository } from './wallet.repository.js';

export class FinalizeReservation {
  constructor(private readonly wallets: WalletRepository) {}

  async execute(reservationId: string): Promise<void> {
    const wallet = await this.wallets.getByReservationForUpdate(reservationId);
    wallet.finalizeReservation(reservationId);
    await this.wallets.save(wallet);
  }
}
