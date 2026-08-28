import { Asset } from './asset.js';
import { InvalidAssetError } from './money.errors.js';

describe('Asset', () => {
  describe('create', () => {
    it('creates an asset with canonical code and precision', () => {
      const asset = Asset.create('USDT', 6);

      expect(asset.code).toBe('USDT');
      expect(asset.decimals).toBe(6);
    });

    it.each(['', 'usdt', ' USDT', 'USDT ', 'USD T', '+USDT'])(
      'rejects invalid asset code "%s"',
      (code) => {
        expect(() => Asset.create(code, 6)).toThrow(InvalidAssetError);
      },
    );

    it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 31])(
      'rejects invalid decimal precision %s',
      (decimals) => {
        expect(() => Asset.create('USDT', decimals)).toThrow(InvalidAssetError);
      },
    );
  });

  describe('equals', () => {
    it('considers assets with the same code and precision equal', () => {
      const left = Asset.create('USDT', 6);
      const right = Asset.create('USDT', 6);

      expect(left.equals(right)).toBe(true);
    });

    it('does not consider assets with different codes equal', () => {
      const usdt = Asset.create('USDT', 6);
      const usdc = Asset.create('USDC', 6);

      expect(usdt.equals(usdc)).toBe(false);
    });

    it('does not consider inconsistent definitions of the same code equal', () => {
      const sixDecimals = Asset.create('USDT', 6);
      const eighteenDecimals = Asset.create('USDT', 18);

      expect(sixDecimals.equals(eighteenDecimals)).toBe(false);
    });
  });
});
