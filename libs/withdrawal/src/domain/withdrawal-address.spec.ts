import { InvalidWithdrawalAddressError } from './withdrawal.errors.js';
import { WithdrawalAddress } from './withdrawal-address.js';

describe('WithdrawalAddress', () => {
  it('normalizes surrounding whitespace', () => {
    expect(WithdrawalAddress.create('  TXYZ123  ').value).toBe('TXYZ123');
  });

  it('compares addresses by value', () => {
    expect(
      WithdrawalAddress.create('TXYZ123').equals(
        WithdrawalAddress.reconstitute('TXYZ123'),
      ),
    ).toBe(true);
  });

  it('rejects a persisted address that is not already normalized', () => {
    expect(() => WithdrawalAddress.reconstitute('  TXYZ123  ')).toThrow(
      InvalidWithdrawalAddressError,
    );
  });

  it.each(['', '   ', 'x'.repeat(257)])(
    'rejects invalid address %s',
    (value) => {
      expect(() => WithdrawalAddress.create(value)).toThrow(
        InvalidWithdrawalAddressError,
      );
    },
  );
});
