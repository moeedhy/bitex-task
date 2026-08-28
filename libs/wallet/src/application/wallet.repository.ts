import type { Asset } from '@bitex/platform';
import type { WalletAccount } from '../domain/wallet-account.js';

export interface WalletRepository {
  getForUpdate(userId: string, asset: Asset): Promise<WalletAccount>;
  getByReservationForUpdate(reservationId: string): Promise<WalletAccount>;
  save(wallet: WalletAccount): Promise<void>;
}
