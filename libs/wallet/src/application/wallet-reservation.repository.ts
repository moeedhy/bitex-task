import type { WalletReservation } from '../domain/wallet-reservation.js';

export interface WalletReservationRepository {
  add(reservation: WalletReservation): Promise<void>;
  getForUpdate(reservationId: string): Promise<WalletReservation>;
  save(reservation: WalletReservation): Promise<void>;
}
