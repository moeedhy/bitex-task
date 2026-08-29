import { CodedError } from '../errors/coded-error.js';

export class InvalidAssetError extends CodedError {
  readonly code = 'INVALID_ASSET' as const;

  constructor(message: string) {
    super(message);
  }
}

export class UnsupportedAssetError extends CodedError {
  readonly code = 'UNSUPPORTED_ASSET' as const;

  constructor(readonly assetCode: string) {
    super(`Asset "${assetCode}" is not supported.`);
  }
}

export class InvalidMoneyAmountError extends CodedError {
  readonly code = 'INVALID_MONEY_AMOUNT' as const;

  constructor() {
    super('Money amount must be a canonical decimal string.');
  }
}

export class MoneyPrecisionExceededError extends CodedError {
  readonly code = 'MONEY_PRECISION_EXCEEDED' as const;

  constructor(
    readonly assetCode: string,
    readonly allowedDecimals: number,
  ) {
    super(`${assetCode} supports at most ${allowedDecimals} decimal places.`);
  }
}

export class AssetMismatchError extends CodedError {
  readonly code = 'ASSET_MISMATCH' as const;

  constructor(
    readonly leftAsset: string,
    readonly rightAsset: string,
  ) {
    super(
      `Cannot perform monetary operation between ${leftAsset} and ${rightAsset}.`,
    );
  }
}
