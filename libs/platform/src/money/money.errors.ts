export class InvalidAssetError extends Error {
  readonly code = 'INVALID_ASSET' as const;

  constructor(message: string) {
    super(message);
    this.name = 'InvalidAssetError';
  }
}

export class UnsupportedAssetError extends Error {
  readonly code = 'UNSUPPORTED_ASSET' as const;

  constructor(readonly assetCode: string) {
    super(`Asset "${assetCode}" is not supported.`);
    this.name = 'UnsupportedAssetError';
  }
}

export class InvalidMoneyAmountError extends Error {
  readonly code = 'INVALID_MONEY_AMOUNT' as const;

  constructor() {
    super('Money amount must be a canonical decimal string.');
    this.name = 'InvalidMoneyAmountError';
  }
}

export class MoneyPrecisionExceededError extends Error {
  readonly code = 'MONEY_PRECISION_EXCEEDED' as const;

  constructor(
    readonly assetCode: string,
    readonly allowedDecimals: number,
  ) {
    super(`${assetCode} supports at most ${allowedDecimals} decimal places.`);
    this.name = 'MoneyPrecisionExceededError';
  }
}

export class AssetMismatchError extends Error {
  readonly code = 'ASSET_MISMATCH' as const;

  constructor(
    readonly leftAsset: string,
    readonly rightAsset: string,
  ) {
    super(
      `Cannot perform monetary operation between ${leftAsset} and ${rightAsset}.`,
    );
    this.name = 'AssetMismatchError';
  }
}
