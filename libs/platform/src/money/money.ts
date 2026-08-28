import { Asset } from './asset.js';
import {
  AssetMismatchError,
  InvalidMoneyAmountError,
  MoneyPrecisionExceededError,
} from './money.errors.js';

type Comparison = -1 | 0 | 1;

const DECIMAL_PATTERN = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/;

export class Money {
  private constructor(
    private readonly atomicUnits: bigint,
    public readonly asset: Asset,
  ) {
    Object.freeze(this);
  }

  static zero(asset: Asset): Money {
    return new Money(0n, asset);
  }

  static fromAtomicUnits(atomicUnits: bigint, asset: Asset): Money {
    if (typeof atomicUnits !== 'bigint') {
      throw new InvalidMoneyAmountError();
    }

    return new Money(atomicUnits, asset);
  }

  static parse(value: string, asset: Asset): Money {
    if (typeof value !== 'string') {
      throw new InvalidMoneyAmountError();
    }

    const match = DECIMAL_PATTERN.exec(value);

    if (!match) {
      throw new InvalidMoneyAmountError();
    }

    const [, signToken, wholePart, fraction = ''] = match;

    if (fraction.length > asset.decimals) {
      throw new MoneyPrecisionExceededError(asset.code, asset.decimals);
    }

    const scale = Money.scaleFor(asset);

    const fractionAtomicUnits =
      fraction.length === 0 ? 0n : BigInt(fraction.padEnd(asset.decimals, '0'));

    const absoluteAtomicUnits = BigInt(wholePart) * scale + fractionAtomicUnits;

    const sign = signToken === '-' ? -1n : 1n;

    return new Money(absoluteAtomicUnits * sign, asset);
  }

  add(other: Money): Money {
    this.assertCompatibleAsset(other);

    return new Money(this.atomicUnits + other.atomicUnits, this.asset);
  }

  subtract(other: Money): Money {
    this.assertCompatibleAsset(other);

    return new Money(this.atomicUnits - other.atomicUnits, this.asset);
  }

  compare(other: Money): Comparison {
    this.assertCompatibleAsset(other);

    if (this.atomicUnits < other.atomicUnits) {
      return -1;
    }

    if (this.atomicUnits > other.atomicUnits) {
      return 1;
    }

    return 0;
  }

  equals(other: Money): boolean {
    return (
      this.asset.equals(other.asset) && this.atomicUnits === other.atomicUnits
    );
  }

  isZero(): boolean {
    return this.atomicUnits === 0n;
  }

  isPositive(): boolean {
    return this.atomicUnits > 0n;
  }

  isNegative(): boolean {
    return this.atomicUnits < 0n;
  }

  isLessThan(other: Money): boolean {
    return this.compare(other) < 0;
  }

  isLessThanOrEqual(other: Money): boolean {
    return this.compare(other) <= 0;
  }

  isGreaterThan(other: Money): boolean {
    return this.compare(other) > 0;
  }

  isGreaterThanOrEqual(other: Money): boolean {
    return this.compare(other) >= 0;
  }

  toAtomicUnits(): bigint {
    return this.atomicUnits;
  }

  toDecimalString(): string {
    if (this.atomicUnits === 0n) {
      return '0';
    }

    const negative = this.atomicUnits < 0n;

    const absoluteAtomicUnits = negative ? -this.atomicUnits : this.atomicUnits;

    const scale = Money.scaleFor(this.asset);

    const wholePart = absoluteAtomicUnits / scale;

    const remainder = absoluteAtomicUnits % scale;

    const sign = negative ? '-' : '';

    if (this.asset.decimals === 0) {
      return `${sign}${wholePart}`;
    }

    const fraction = remainder
      .toString()
      .padStart(this.asset.decimals, '0')
      .replace(/0+$/, '');

    if (fraction.length === 0) {
      return `${sign}${wholePart}`;
    }

    return `${sign}${wholePart}.${fraction}`;
  }

  private assertCompatibleAsset(other: Money): void {
    if (!this.asset.equals(other.asset)) {
      throw new AssetMismatchError(
        Money.describeAsset(this.asset),
        Money.describeAsset(other.asset),
      );
    }
  }

  private static scaleFor(asset: Asset): bigint {
    return 10n ** BigInt(asset.decimals);
  }

  private static describeAsset(asset: Asset): string {
    return `${asset.code}/${asset.decimals}`;
  }
}
