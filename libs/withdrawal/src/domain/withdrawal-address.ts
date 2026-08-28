import { InvalidWithdrawalAddressError } from './withdrawal.errors.js';

const MAX_ADDRESS_LENGTH = 256;

export class WithdrawalAddress {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static create(raw: string): WithdrawalAddress {
    return new WithdrawalAddress(WithdrawalAddress.normalize(raw));
  }

  /**
   * Every persisted destination was normalized by `create`, so a stored value
   * that still needs normalizing signals a persistence defect rather than
   * untrusted input, and must not be silently repaired on load.
   */
  static reconstitute(stored: string): WithdrawalAddress {
    const normalized = WithdrawalAddress.normalize(stored);
    if (normalized !== stored) {
      throw new InvalidWithdrawalAddressError(
        'Persisted withdrawal destination is not stored in normalized form.',
      );
    }
    return new WithdrawalAddress(normalized);
  }

  equals(other: WithdrawalAddress): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  private static normalize(raw: string): string {
    if (typeof raw !== 'string') {
      throw new InvalidWithdrawalAddressError();
    }
    const value = raw.trim();
    if (value.length === 0 || value.length > MAX_ADDRESS_LENGTH) {
      throw new InvalidWithdrawalAddressError(
        `Withdrawal destination must contain 1-${MAX_ADDRESS_LENGTH} characters.`,
      );
    }
    return value;
  }
}
