import { Money, resolveAsset } from '@bitex/platform';
import type { Asset } from '@bitex/platform';
import { WalletAccount } from '@bitex/wallet';
import type { ReservationSnapshot, WalletRepository } from '@bitex/wallet';
import type { PostgresTransactionRunner } from './postgres-transaction-runner.js';

interface WalletRow {
  id: string;
  user_id: string;
  asset: string;
  balance_atomic: string;
  reserved_atomic: string;
}

interface ReservationRow {
  id: string;
  withdrawal_id: string;
  amount_atomic: string;
  status: ReservationSnapshot['status'];
}

export class PostgresWalletRepository implements WalletRepository {
  constructor(
    private readonly transaction: Pick<PostgresTransactionRunner, 'client'>,
  ) {}

  async getForUpdate(userId: string, asset: Asset): Promise<WalletAccount> {
    const client = this.transaction.client();
    const result = await client.query<WalletRow>(
      `SELECT id, user_id, asset, balance_atomic, reserved_atomic
       FROM wallets
       WHERE user_id = $1 AND asset = $2
       FOR UPDATE`,
      [userId, asset.code],
    );
    if (result.rowCount !== 1) {
      throw new Error(`Wallet for ${userId}/${asset.code} was not found.`);
    }
    return this.hydrate(result.rows[0]);
  }

  async getByReservationForUpdate(
    reservationId: string,
  ): Promise<WalletAccount> {
    const client = this.transaction.client();
    const result = await client.query<WalletRow>(
      `SELECT w.id, w.user_id, w.asset, w.balance_atomic, w.reserved_atomic
       FROM wallets w
       JOIN wallet_reservations r ON r.wallet_id = w.id
       WHERE r.id = $1
       FOR UPDATE OF w`,
      [reservationId],
    );
    if (result.rowCount !== 1) {
      throw new Error(`Wallet reservation "${reservationId}" was not found.`);
    }
    return this.hydrate(result.rows[0]);
  }

  async save(wallet: WalletAccount): Promise<void> {
    const client = this.transaction.client();
    const snapshot = wallet.toSnapshot();
    await client.query(
      `UPDATE wallets
       SET balance_atomic = $2, reserved_atomic = $3, updated_at = now()
       WHERE id = $1`,
      [
        snapshot.id,
        snapshot.balance.toAtomicUnits().toString(),
        snapshot.reservedBalance.toAtomicUnits().toString(),
      ],
    );
    for (const reservation of snapshot.reservations) {
      await client.query(
        `INSERT INTO wallet_reservations
           (id, wallet_id, withdrawal_id, amount_atomic, status)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE
         SET status = EXCLUDED.status, updated_at = now()`,
        [
          reservation.id,
          snapshot.id,
          reservation.withdrawalId,
          reservation.amount.toAtomicUnits().toString(),
          reservation.status,
        ],
      );
    }
  }

  private async hydrate(row: WalletRow): Promise<WalletAccount> {
    const client = this.transaction.client();
    const asset = resolveAsset(row.asset);
    const reservations = await client.query<ReservationRow>(
      `SELECT id, withdrawal_id, amount_atomic, status
       FROM wallet_reservations
       WHERE wallet_id = $1
       ORDER BY created_at`,
      [row.id],
    );
    return WalletAccount.restore({
      id: row.id,
      userId: row.user_id,
      asset,
      balance: Money.fromAtomicUnits(BigInt(row.balance_atomic), asset),
      reservedBalance: Money.fromAtomicUnits(
        BigInt(row.reserved_atomic),
        asset,
      ),
      reservations: reservations.rows.map((reservation) => ({
        id: reservation.id,
        withdrawalId: reservation.withdrawal_id,
        amount: Money.fromAtomicUnits(BigInt(reservation.amount_atomic), asset),
        status: reservation.status,
      })),
    });
  }
}
