import { Asset } from './asset.js';
import { UnsupportedAssetError } from './money.errors.js';

export const Assets = Object.freeze({
  USDT: Asset.create('USDT', 6),
});

const assetsByCode = new Map<string, Asset>(
  Object.values(Assets).map((asset) => [
    asset.code,
    asset,
  ]),
);

export function resolveAsset(code: string): Asset {
  const asset =
    typeof code === 'string'
      ? assetsByCode.get(code)
      : undefined;

  if (!asset) {
    throw new UnsupportedAssetError(String(code));
  }

  return asset;
}
