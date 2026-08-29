import type { Asset, UserId } from '@bitex/platform';
import type { WalletId } from '../domain/wallet-id.js';
import type { WalletAccount } from '../domain/wallet-account.js';

export interface WalletRepository {
  getForUpdate(userId: UserId, asset: Asset): Promise<WalletAccount>;
  getByIdForUpdate(walletId: WalletId): Promise<WalletAccount>;
  save(wallet: WalletAccount): Promise<void>;
}
