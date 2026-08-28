import { Asset, Money } from '@bitex/platform';
import { Reservation } from './reservation.js';
import type { ReservationSnapshot } from './reservation.js';
import {
  DuplicateWithdrawalReservationError,
  InsufficientAvailableBalanceError,
  InvalidReservationAmountError,
  InvalidWalletStateError,
  ReservationNotFoundError,
} from './wallet.errors.js';

export class WalletAccount {
  private readonly reservations = new Map<string, Reservation>();

  private constructor(
    readonly id: string,
    readonly userId: string,
    readonly asset: Asset,
    private currentBalance: Money,
    private currentReservedBalance: Money,
  ) {}

  static create(input: {
    id: string;
    userId: string;
    asset: Asset;
    balance: Money;
  }): WalletAccount {
    WalletAccount.assertBalances(
      input.asset,
      input.balance,
      Money.zero(input.asset),
    );
    return new WalletAccount(
      input.id,
      input.userId,
      input.asset,
      input.balance,
      Money.zero(input.asset),
    );
  }

  static restore(input: {
    id: string;
    userId: string;
    asset: Asset;
    balance: Money;
    reservedBalance: Money;
    reservations: ReservationSnapshot[];
  }): WalletAccount {
    WalletAccount.assertBalances(
      input.asset,
      input.balance,
      input.reservedBalance,
    );
    const wallet = new WalletAccount(
      input.id,
      input.userId,
      input.asset,
      input.balance,
      input.reservedBalance,
    );
    for (const snapshot of input.reservations) {
      wallet.reservations.set(snapshot.id, Reservation.restore(snapshot));
    }
    return wallet;
  }

  get balance(): Money {
    return this.currentBalance;
  }

  get reservedBalance(): Money {
    return this.currentReservedBalance;
  }

  get availableBalance(): Money {
    return this.currentBalance.subtract(this.currentReservedBalance);
  }

  reserve(input: {
    reservationId: string;
    withdrawalId: string;
    amount: Money;
  }): Reservation {
    if (!input.amount.isPositive()) {
      throw new InvalidReservationAmountError();
    }

    if (this.findByWithdrawalId(input.withdrawalId)) {
      throw new DuplicateWithdrawalReservationError(input.withdrawalId);
    }

    if (input.amount.isGreaterThan(this.availableBalance)) {
      throw new InsufficientAvailableBalanceError();
    }

    const reservation = Reservation.create({
      id: input.reservationId,
      withdrawalId: input.withdrawalId,
      amount: input.amount,
    });

    this.reservations.set(reservation.id, reservation);
    this.currentReservedBalance = this.currentReservedBalance.add(input.amount);
    return reservation;
  }

  finalizeReservation(reservationId: string): void {
    const reservation = this.getReservation(reservationId);
    reservation.finalize();
    this.currentReservedBalance = this.currentReservedBalance.subtract(
      reservation.amount,
    );
    this.currentBalance = this.currentBalance.subtract(reservation.amount);
  }

  releaseReservation(reservationId: string): void {
    const reservation = this.getReservation(reservationId);
    reservation.release();
    this.currentReservedBalance = this.currentReservedBalance.subtract(
      reservation.amount,
    );
  }

  getReservation(reservationId: string): Reservation {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      throw new ReservationNotFoundError(reservationId);
    }
    return reservation;
  }

  toSnapshot(): {
    id: string;
    userId: string;
    asset: Asset;
    balance: Money;
    reservedBalance: Money;
    reservations: ReservationSnapshot[];
  } {
    return {
      id: this.id,
      userId: this.userId,
      asset: this.asset,
      balance: this.currentBalance,
      reservedBalance: this.currentReservedBalance,
      reservations: [...this.reservations.values()].map((reservation) =>
        reservation.toSnapshot(),
      ),
    };
  }

  private findByWithdrawalId(withdrawalId: string): Reservation | undefined {
    return [...this.reservations.values()].find(
      (reservation) => reservation.withdrawalId === withdrawalId,
    );
  }

  private static assertBalances(
    asset: Asset,
    balance: Money,
    reservedBalance: Money,
  ): void {
    if (!balance.asset.equals(asset) || !reservedBalance.asset.equals(asset)) {
      throw new InvalidWalletStateError(
        'Wallet balances must use the wallet asset.',
      );
    }
    if (balance.isNegative() || reservedBalance.isNegative()) {
      throw new InvalidWalletStateError(
        'Wallet and reserved balances cannot be negative.',
      );
    }
    if (reservedBalance.isGreaterThan(balance)) {
      throw new InvalidWalletStateError(
        'Reserved balance cannot exceed total balance.',
      );
    }
  }
}
