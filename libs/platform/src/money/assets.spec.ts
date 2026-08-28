import { Assets, resolveAsset } from './assets.js';
import { UnsupportedAssetError } from './money.errors.js';

describe('asset catalog', () => {
  it('contains the canonical USDT definition', () => {
    expect(Assets.USDT.code).toBe('USDT');
    expect(Assets.USDT.decimals).toBe(6);
  });

  it('returns the canonical asset instance', () => {
    expect(resolveAsset('USDT')).toBe(Assets.USDT);
  });

  it('rejects an unsupported asset', () => {
    expect(() => resolveAsset('BTC')).toThrow(UnsupportedAssetError);
  });

  it('does not silently normalize asset codes', () => {
    expect(() => resolveAsset('usdt')).toThrow(UnsupportedAssetError);
  });
});
