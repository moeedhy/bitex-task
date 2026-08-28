import type { Money } from '@bitex/platform';
import {
  InvalidReservationAmountError,
  InvalidReservationTransitionError,
  InvalidWalletStateError,
} from './wallet.errors.js';

export type WalletReservationStatus = 'ACTIVE' | 'FINALIZED' | 'RELEASED';

export interface WalletReservationSnapshot {
  id: string;
  walletId: string;
  withdrawalId: string;
  amount: Money;
  status: WalletReservationStatus;
}

export class WalletReservation {
  private constructor(private readonly state: WalletReservationSnapshot) {}

  static open(
    input: Omit<WalletReservationSnapshot, 'status'>,
  ): WalletReservation {
    WalletReservation.assertIdentity(input.id, 'Reservation');
    WalletReservation.assertIdentity(input.walletId, 'Wallet');
    WalletReservation.assertIdentity(input.withdrawalId, 'Withdrawal');
    if (!input.amount.isPositive()) {
      throw new InvalidReservationAmountError();
    }
    return new WalletReservation({ ...input, status: 'ACTIVE' });
  }

  static reconstitute(snapshot: WalletReservationSnapshot): WalletReservation {
    WalletReservation.assertIdentity(snapshot.id, 'Reservation');
    WalletReservation.assertIdentity(snapshot.walletId, 'Wallet');
    WalletReservation.assertIdentity(snapshot.withdrawalId, 'Withdrawal');
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

  get id(): string {
    return this.state.id;
  }

  get walletId(): string {
    return this.state.walletId;
  }

  get withdrawalId(): string {
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

  private static assertIdentity(value: string, label: string): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new InvalidWalletStateError(`${label} identity is required.`);
    }
  }
}
