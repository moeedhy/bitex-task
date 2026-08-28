import { Money, resolveAsset } from '@bitex/platform';
import type { Asset } from '@bitex/platform';
import { WalletAccount, WalletNotFoundError } from '@bitex/wallet';
import type { WalletRepository } from '@bitex/wallet';
import type { PostgresTransactionRunner } from './postgres-transaction-runner.js';

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
    private readonly transaction: Pick<PostgresTransactionRunner, 'client'>,
  ) {}

  async getForUpdate(userId: string, asset: Asset): Promise<WalletAccount> {
    const result = await this.transaction.client().query<WalletRow>(
      `SELECT ${columns}
       FROM wallets
       WHERE user_id = $1 AND asset = $2
       FOR UPDATE`,
      [userId, asset.code],
    );
    return this.requireWallet(result.rows[0], `${userId}/${asset.code}`);
  }

  async getByIdForUpdate(walletId: string): Promise<WalletAccount> {
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
    await this.transaction.client().query(
      `UPDATE wallets
       SET balance_atomic = $2, reserved_atomic = $3, updated_at = now()
       WHERE id = $1`,
      [
        snapshot.id,
        snapshot.balance.toAtomicUnits().toString(),
        snapshot.reservedBalance.toAtomicUnits().toString(),
      ],
    );
  }

  private requireWallet(row: WalletRow | undefined, identity: string) {
    if (!row) {
      throw new WalletNotFoundError(identity);
    }
    const asset = resolveAsset(row.asset);
    return WalletAccount.reconstitute({
      id: row.id,
      userId: row.user_id,
      asset,
      balance: Money.fromAtomicUnits(BigInt(row.balance_atomic), asset),
      reservedBalance: Money.fromAtomicUnits(
        BigInt(row.reserved_atomic),
        asset,
      ),
    });
  }
}
