import {
  Money,
  ReservationId,
  resolveAsset,
  WithdrawalId,
} from '@bitex/platform';
import {
  ReservationNotFoundError,
  WalletId,
  WalletReservation,
} from '@bitex/wallet';
import type {
  WalletReservationRepository,
  WalletReservationSnapshot,
} from '@bitex/wallet';
import type { TransactionalClient } from '../shared/transactional-client.js';
import { requireSingleRow } from '../shared/stale-write.js';

interface ReservationRow {
  id: string;
  wallet_id: string;
  withdrawal_id: string;
  asset: string;
  amount_atomic: string;
  status: WalletReservationSnapshot['status'];
}

export class PostgresWalletReservationRepository
  implements WalletReservationRepository
{
  constructor(
    private readonly transaction: TransactionalClient,
  ) {}

  async add(reservation: WalletReservation): Promise<void> {
    const snapshot = reservation.toSnapshot();
    await this.transaction.client().query(
      `INSERT INTO wallet_reservations
        (id, wallet_id, withdrawal_id, asset, amount_atomic, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        snapshot.id,
        snapshot.walletId,
        snapshot.withdrawalId,
        snapshot.amount.asset.code,
        snapshot.amount.toAtomicUnits().toString(),
        snapshot.status,
      ],
    );
  }

  async getForUpdate(reservationId: ReservationId): Promise<WalletReservation> {
    const result = await this.transaction.client().query<ReservationRow>(
      `SELECT id, wallet_id, withdrawal_id, asset, amount_atomic, status
       FROM wallet_reservations
       WHERE id = $1
       FOR UPDATE`,
      [reservationId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ReservationNotFoundError(reservationId);
    }
    const asset = resolveAsset(row.asset);
    return WalletReservation.reconstitute({
      id: ReservationId.parse(row.id),
      walletId: WalletId.parse(row.wallet_id),
      withdrawalId: WithdrawalId.parse(row.withdrawal_id),
      amount: Money.fromAtomicUnits(BigInt(row.amount_atomic), asset),
      status: row.status,
    });
  }

  async save(reservation: WalletReservation): Promise<void> {
    const snapshot = reservation.toSnapshot();
    const result = await this.transaction.client().query(
      `UPDATE wallet_reservations
       SET status = $2, updated_at = now()
       WHERE id = $1`,
      [snapshot.id, snapshot.status],
    );
    requireSingleRow(result, 'wallet_reservations', snapshot.id);
  }
}
