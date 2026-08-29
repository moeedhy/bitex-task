import { identity } from '@bitex/platform';
import type { Uuid } from '@bitex/platform';

/**
 * Context-private: nothing outside this library refers to a wallet by its own
 * id. Callers address wallets by `(userId, asset)`, which is why the
 * `wallets` table carries a unique constraint on that pair.
 */
export type WalletId = Uuid<'WalletId'>;
export const WalletId = identity('WalletId');
