import { InvalidAssetError } from './money.errors.js';

const ASSET_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;

/**
 * Operational safety bound.
 *
 * Covers common digital assets, including 18-decimal tokens, without
 * allowing accidentally extreme scale values.
 */
const MAX_ASSET_DECIMALS = 30;

export class Asset {
  private constructor(
    public readonly code: string,
    public readonly decimals: number,
  ) {
    Object.freeze(this);
  }

  static create(code: string, decimals: number): Asset {
    if (typeof code !== 'string' || !ASSET_CODE_PATTERN.test(code)) {
      throw new InvalidAssetError(
        'Asset code must be 1-32 canonical uppercase characters using A-Z, 0-9, ".", "_" or "-".',
      );
    }

    if (
      !Number.isInteger(decimals) ||
      decimals < 0 ||
      decimals > MAX_ASSET_DECIMALS
    ) {
      throw new InvalidAssetError(
        `Asset decimals must be an integer between 0 and ${MAX_ASSET_DECIMALS}.`,
      );
    }

    return new Asset(code, decimals);
  }

  equals(other: Asset): boolean {
    return this.code === other.code && this.decimals === other.decimals;
  }

  toString(): string {
    return this.code;
  }
}
