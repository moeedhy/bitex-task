import { Asset } from './asset.js';
import { Assets } from './assets.js';
import {
  AssetMismatchError,
  InvalidMoneyAmountError,
  MoneyPrecisionExceededError,
} from './money.errors.js';
import { Money } from './money.js';

describe('Money', () => {
  const USDT = Assets.USDT;

  describe('parse', () => {
    it.each([
      ['0', 0n],
      ['100', 100_000_000n],
      ['100.25', 100_250_000n],
      ['0.000001', 1n],
      ['-10.5', -10_500_000n],
      ['100.000000', 100_000_000n],
    ])('parses "%s" exactly', (value, expectedAtomicUnits) => {
      const money = Money.parse(value, USDT);

      expect(money.toAtomicUnits()).toBe(expectedAtomicUnits);
    });

    it.each([
      '',
      ' ',
      ' 100',
      '100 ',
      '+100',
      '.5',
      '1.',
      '01',
      '1e6',
      '1e-6',
      '1_000',
      '1,000',
      '$100',
      '100 USDT',
      'NaN',
      'Infinity',
    ])('rejects non-canonical monetary input "%s"', (value) => {
      expect(() => Money.parse(value, USDT)).toThrow(
        InvalidMoneyAmountError,
      );
    });

    it('rejects JavaScript numbers at runtime', () => {
      expect(() =>
        Money.parse(0.1 as unknown as string, USDT),
      ).toThrow(InvalidMoneyAmountError);
    });

    it('rejects precision beyond the asset precision', () => {
      expect(() => Money.parse('0.0000001', USDT)).toThrow(
        MoneyPrecisionExceededError,
      );
    });

    it('rejects excess precision even when extra digits are zero', () => {
      expect(() => Money.parse('1.0000000', USDT)).toThrow(
        MoneyPrecisionExceededError,
      );
    });
  });

  describe('fromAtomicUnits', () => {
    it('creates money without decimal conversion', () => {
      const money = Money.fromAtomicUnits(123_456_789n, USDT);

      expect(money.toAtomicUnits()).toBe(123_456_789n);
    });
  });

  describe('zero', () => {
    it('creates zero for a specific asset', () => {
      const zero = Money.zero(USDT);

      expect(zero.toAtomicUnits()).toBe(0n);
      expect(zero.asset.equals(USDT)).toBe(true);
    });
  });

  describe('toDecimalString', () => {
    it.each([
      [0n, '0'],
      [100_000_000n, '100'],
      [100_250_000n, '100.25'],
      [1n, '0.000001'],
      [-1n, '-0.000001'],
      [-10_500_000n, '-10.5'],
    ])(
      'formats %s atomic units canonically',
      (atomicUnits, expected) => {
        const money = Money.fromAtomicUnits(atomicUnits, USDT);

        expect(money.toDecimalString()).toBe(expected);
      },
    );

    it('supports assets with zero decimals', () => {
      const asset = Asset.create('POINT', 0);

      expect(
        Money.fromAtomicUnits(42n, asset).toDecimalString(),
      ).toBe('42');
    });
  });

  describe('add', () => {
    it('adds exact same-asset amounts', () => {
      const left = Money.parse('100.1', USDT);
      const right = Money.parse('20.2', USDT);

      const result = left.add(right);

      expect(result.toDecimalString()).toBe('120.3');
    });

    it('does not mutate either operand', () => {
      const left = Money.parse('100', USDT);
      const right = Money.parse('20', USDT);

      left.add(right);

      expect(left.toDecimalString()).toBe('100');
      expect(right.toDecimalString()).toBe('20');
    });
  });

  describe('subtract', () => {
    it('subtracts exact same-asset amounts', () => {
      const result = Money.parse('100', USDT).subtract(
        Money.parse('80', USDT),
      );

      expect(result.toDecimalString()).toBe('20');
    });

    it('allows a negative mathematical result', () => {
      const result = Money.parse('20', USDT).subtract(
        Money.parse('80', USDT),
      );

      expect(result.toDecimalString()).toBe('-60');
    });
  });

  describe('asset safety', () => {
    it('rejects addition across different assets', () => {
      const BTC = Asset.create('BTC', 8);

      expect(() =>
        Money.parse('1', USDT).add(Money.parse('1', BTC)),
      ).toThrow(AssetMismatchError);
    });

    it('rejects subtraction across different assets', () => {
      const BTC = Asset.create('BTC', 8);

      expect(() =>
        Money.parse('1', USDT).subtract(Money.parse('1', BTC)),
      ).toThrow(AssetMismatchError);
    });

    it('rejects comparison across different assets', () => {
      const BTC = Asset.create('BTC', 8);

      expect(() =>
        Money.parse('1', USDT).compare(Money.parse('1', BTC)),
      ).toThrow(AssetMismatchError);
    });

    it('rejects same-code assets with incompatible precision', () => {
      const brokenUSDT = Asset.create('USDT', 18);

      expect(() =>
        Money.parse('1', USDT).add(
          Money.parse('1', brokenUSDT),
        ),
      ).toThrow(AssetMismatchError);
    });
  });

  describe('equals', () => {
    it('uses monetary value rather than input formatting', () => {
      expect(
        Money.parse('100', USDT).equals(
          Money.parse('100.000000', USDT),
        ),
      ).toBe(true);
    });

    it('returns false for different assets', () => {
      const BTC = Asset.create('BTC', 8);

      expect(
        Money.parse('1', USDT).equals(Money.parse('1', BTC)),
      ).toBe(false);
    });
  });

  describe('comparison', () => {
    const one = () => Money.parse('1', USDT);
    const two = () => Money.parse('2', USDT);

    it('compares monetary values', () => {
      expect(one().compare(two())).toBe(-1);
      expect(two().compare(one())).toBe(1);
      expect(one().compare(one())).toBe(0);
    });

    it('supports intention-revealing comparison methods', () => {
      expect(one().isLessThan(two())).toBe(true);
      expect(one().isLessThanOrEqual(two())).toBe(true);
      expect(two().isGreaterThan(one())).toBe(true);
      expect(two().isGreaterThanOrEqual(one())).toBe(true);
      expect(one().isGreaterThan(one())).toBe(false);
    });
  });

  describe('sign predicates', () => {
    it('identifies zero', () => {
      expect(Money.parse('0', USDT).isZero()).toBe(true);
    });

    it('identifies positive amounts', () => {
      expect(Money.parse('1', USDT).isPositive()).toBe(true);
    });

    it('identifies negative amounts', () => {
      expect(Money.parse('-1', USDT).isNegative()).toBe(true);
    });
  });
});
