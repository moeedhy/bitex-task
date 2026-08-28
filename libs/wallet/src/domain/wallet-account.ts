import { Money } from '@bitex/platform';
import type { Asset } from '@bitex/platform';
import {
  InsufficientAvailableBalanceError,
  InsufficientReservedBalanceError,
  InvalidWalletAmountError,
  InvalidWalletStateError,
  WalletAssetMismatchError,
} from './wallet.errors.js';

export interface WalletAccountSnapshot {
  id: string;
  userId: string;
  asset: Asset;
  balance: Money;
  reservedBalance: Money;
}

export class WalletAccount {
  private constructor(private state: WalletAccountSnapshot) {}

  static create(
    input: Omit<WalletAccountSnapshot, 'reservedBalance'>,
  ): WalletAccount {
    const state = { ...input, reservedBalance: Money.zero(input.asset) };
    WalletAccount.assertIdentity(state.id, 'Wallet');
    WalletAccount.assertIdentity(state.userId, 'User');
    WalletAccount.assertBalances(state);
    return new WalletAccount(state);
  }

  static reconstitute(snapshot: WalletAccountSnapshot): WalletAccount {
    WalletAccount.assertIdentity(snapshot.id, 'Wallet');
    WalletAccount.assertIdentity(snapshot.userId, 'User');
    WalletAccount.assertBalances(snapshot);
    return new WalletAccount({ ...snapshot });
  }

  get id(): string {
    return this.state.id;
  }

  get userId(): string {
    return this.state.userId;
  }

  get asset(): Asset {
    return this.state.asset;
  }

  get balance(): Money {
    return this.state.balance;
  }

  get reservedBalance(): Money {
    return this.state.reservedBalance;
  }

  get availableBalance(): Money {
    return this.state.balance.subtract(this.state.reservedBalance);
  }

  reserve(amount: Money): void {
    this.assertOperationAmount(amount);
    if (amount.isGreaterThan(this.availableBalance)) {
      throw new InsufficientAvailableBalanceError();
    }
    this.commit({
      ...this.state,
      reservedBalance: this.state.reservedBalance.add(amount),
    });
  }

  releaseReserved(amount: Money): void {
    this.assertOperationAmount(amount);
    if (amount.isGreaterThan(this.state.reservedBalance)) {
      throw new InsufficientReservedBalanceError();
    }
    this.commit({
      ...this.state,
      reservedBalance: this.state.reservedBalance.subtract(amount),
    });
  }

  captureReserved(amount: Money): void {
    this.assertOperationAmount(amount);
    if (amount.isGreaterThan(this.state.reservedBalance)) {
      throw new InsufficientReservedBalanceError();
    }
    this.commit({
      ...this.state,
      balance: this.state.balance.subtract(amount),
      reservedBalance: this.state.reservedBalance.subtract(amount),
    });
  }

  toSnapshot(): WalletAccountSnapshot {
    return { ...this.state };
  }

  /**
   * Swaps in a candidate state only once it satisfies every balance invariant,
   * so a rejected operation cannot leave the aggregate partially mutated.
   */
  private commit(next: WalletAccountSnapshot): void {
    WalletAccount.assertBalances(next);
    this.state = next;
  }

  private assertOperationAmount(amount: Money): void {
    if (!amount.asset.equals(this.state.asset)) {
      throw new WalletAssetMismatchError();
    }
    if (!amount.isPositive()) {
      throw new InvalidWalletAmountError();
    }
  }

  private static assertBalances(state: WalletAccountSnapshot): void {
    if (
      !state.balance.asset.equals(state.asset) ||
      !state.reservedBalance.asset.equals(state.asset)
    ) {
      throw new InvalidWalletStateError(
        'Wallet balances must use the wallet asset.',
      );
    }
    if (state.balance.isNegative() || state.reservedBalance.isNegative()) {
      throw new InvalidWalletStateError(
        'Wallet and reserved balances cannot be negative.',
      );
    }
    if (state.reservedBalance.isGreaterThan(state.balance)) {
      throw new InvalidWalletStateError(
        'Reserved balance cannot exceed total balance.',
      );
    }
  }

  private static assertIdentity(value: string, label: string): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new InvalidWalletStateError(`${label} identity is required.`);
    }
  }
}
