import type { Money, ReservationId, WithdrawalId } from '@bitex/platform';
import type { WalletId } from './wallet-id.js';
import {
  InvalidReservationAmountError,
  InvalidReservationTransitionError,
  InvalidWalletStateError,
} from './wallet.errors.js';

/**
 * Declared as a value so the type and its runtime guard cannot drift; the
 * guard below was previously a second array literal written by hand.
 */
export const WALLET_RESERVATION_STATUSES = [
  'ACTIVE',
  'FINALIZED',
  'RELEASED',
] as const;

export type WalletReservationStatus =
  (typeof WALLET_RESERVATION_STATUSES)[number];

export function isWalletReservationStatus(
  value: unknown,
): value is WalletReservationStatus {
  return (WALLET_RESERVATION_STATUSES as readonly unknown[]).includes(value);
}

export interface WalletReservationSnapshot {
  id: ReservationId;
  walletId: WalletId;
  withdrawalId: WithdrawalId;
  amount: Money;
  status: WalletReservationStatus;
}

export class WalletReservation {
  private constructor(private state: WalletReservationSnapshot) {}

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
    if (!isWalletReservationStatus(snapshot.status)) {
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
    this.commit('finalize', 'FINALIZED');
  }

  release(): void {
    this.commit('release', 'RELEASED');
  }

  toSnapshot(): WalletReservationSnapshot {
    return { ...this.state };
  }

  /**
   * Validates the transition, then swaps the whole state -- the discipline
   * `WalletAccount` already followed. Assigning `this.state.status` in place
   * left the aggregate changed even when a later check rejected it.
   */
  private commit(action: string, target: WalletReservationStatus): void {
    if (this.state.status !== 'ACTIVE') {
      throw new InvalidReservationTransitionError(
        this.state.id,
        this.state.status,
        action,
      );
    }
    this.state = { ...this.state, status: target };
  }

}
