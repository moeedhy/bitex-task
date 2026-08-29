import { Money, resolveAsset, UserId } from '@bitex/platform';
import type { Asset } from '@bitex/platform';
import { WalletAccount, WalletNotFoundError } from '@bitex/wallet';
import { WalletId } from '@bitex/wallet';
import type { WalletRepository } from '@bitex/wallet';
import type { TransactionalClient } from '../shared/transactional-client.js';
import { requireSingleRow } from '../shared/stale-write.js';

interface WalletRow {
  id: string;
  user_id: string;
  asset: string;
  balance_atomic: string;
  reserved_atomic: string;
}

const columns = 'id, user_id, asset, balance_atomic, reserved_atomic';

export class PostgresWalletRepository implements WalletRepository {
  constructor(
    private readonly transaction: TransactionalClient,
  ) {}

  async getForUpdate(userId: UserId, asset: Asset): Promise<WalletAccount> {
    const result = await this.transaction.client().query<WalletRow>(
      `SELECT ${columns}
       FROM wallets
       WHERE user_id = $1 AND asset = $2
       FOR UPDATE`,
      [userId, asset.code],
    );
    return this.requireWallet(result.rows[0], `${userId}/${asset.code}`);
  }

  async getByIdForUpdate(walletId: WalletId): Promise<WalletAccount> {
    const result = await this.transaction.client().query<WalletRow>(
      `SELECT ${columns}
       FROM wallets
       WHERE id = $1
       FOR UPDATE`,
      [walletId],
    );
    return this.requireWallet(result.rows[0], walletId);
  }

  async save(wallet: WalletAccount): Promise<void> {
    const snapshot = wallet.toSnapshot();
    const result = await this.transaction.client().query(
      `UPDATE wallets
       SET balance_atomic = $2, reserved_atomic = $3, updated_at = now()
       WHERE id = $1`,
      [
        snapshot.id,
        snapshot.balance.toAtomicUnits().toString(),
        snapshot.reservedBalance.toAtomicUnits().toString(),
      ],
    );
    requireSingleRow(result, 'wallets', snapshot.id);
  }

  private requireWallet(row: WalletRow | undefined, identity: string) {
    if (!row) {
      throw new WalletNotFoundError(identity);
    }
    const asset = resolveAsset(row.asset);
    return WalletAccount.reconstitute({
      // Parsed, not cast. The column is still TEXT until the identity
      // migration lands, so the database is not yet the guarantee the branded
      // type claims -- this is where that gap is closed.
      id: WalletId.parse(row.id),
      userId: UserId.parse(row.user_id),
      asset,
      balance: Money.fromAtomicUnits(BigInt(row.balance_atomic), asset),
      reservedBalance: Money.fromAtomicUnits(
        BigInt(row.reserved_atomic),
        asset,
      ),
    });
  }
}
