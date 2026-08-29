import type { Money, ReservationId, WithdrawalId } from '@bitex/platform';
import type { WalletId } from './wallet-id.js';
import {
  InvalidReservationAmountError,
  InvalidReservationTransitionError,
  InvalidWalletStateError,
} from './wallet.errors.js';

export type WalletReservationStatus = 'ACTIVE' | 'FINALIZED' | 'RELEASED';

export interface WalletReservationSnapshot {
  id: ReservationId;
  walletId: WalletId;
  withdrawalId: WithdrawalId;
  amount: Money;
  status: WalletReservationStatus;
}

export class WalletReservation {
  private constructor(private readonly state: WalletReservationSnapshot) {}

  static open(
    input: Omit<WalletReservationSnapshot, 'status'>,
  ): WalletReservation {
    if (!input.amount.isPositive()) {
      throw new InvalidReservationAmountError();
    }
    return new WalletReservation({ ...input, status: 'ACTIVE' });
  }

  static reconstitute(snapshot: WalletReservationSnapshot): WalletReservation {
    if (!snapshot.amount.isPositive()) {
      throw new InvalidReservationAmountError();
    }
    if (!['ACTIVE', 'FINALIZED', 'RELEASED'].includes(snapshot.status)) {
      throw new InvalidWalletStateError(
        `Unknown wallet reservation status "${String(snapshot.status)}".`,
      );
    }
    return new WalletReservation({ ...snapshot });
  }

  get id(): ReservationId {
    return this.state.id;
  }

  get walletId(): WalletId {
    return this.state.walletId;
  }

  get withdrawalId(): WithdrawalId {
    return this.state.withdrawalId;
  }

  get amount(): Money {
    return this.state.amount;
  }

  get status(): WalletReservationStatus {
    return this.state.status;
  }

  finalize(): void {
    this.assertActive('finalize');
    this.state.status = 'FINALIZED';
  }

  release(): void {
    this.assertActive('release');
    this.state.status = 'RELEASED';
  }

  toSnapshot(): WalletReservationSnapshot {
    return { ...this.state };
  }

  private assertActive(action: string): void {
    if (this.state.status !== 'ACTIVE') {
      throw new InvalidReservationTransitionError(
        this.state.id,
        this.state.status,
        action,
      );
    }
  }

}
