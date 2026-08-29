import { Assets, Money } from '@bitex/platform';
import { createRequestFingerprint } from './request-fingerprint.js';

describe('createRequestFingerprint', () => {
  const command = {
    idempotencyKey: 'key-123',
    userId: 'user-123',
    amount: Money.parse('100', Assets.USDT),
    destinationAddress: 'TXYZ123456789',
  };

  it('ignores how the same amount and destination were written', () => {
    expect(
      createRequestFingerprint({
        ...command,
        amount: Money.parse('100.000000', Assets.USDT),
        destinationAddress: '  TXYZ123456789  ',
      }),
    ).toBe(createRequestFingerprint(command));
  });

  it('ignores the idempotency key itself', () => {
    expect(
      createRequestFingerprint({ ...command, idempotencyKey: 'other-key' }),
    ).toBe(createRequestFingerprint(command));
  });

  it.each([
    ['user', { userId: 'user-456' }],
    ['amount', { amount: Money.parse('100.000001', Assets.USDT) }],
    ['destination', { destinationAddress: 'TOTHER987654321' }],
  ])('separates requests that differ by %s', (_label, overrides) => {
    expect(createRequestFingerprint({ ...command, ...overrides })).not.toBe(
      createRequestFingerprint(command),
    );
  });

  it('cannot be spoofed by moving content across field boundaries', () => {
    expect(
      createRequestFingerprint({ ...command, userId: 'user-123|4:USDT' }),
    ).not.toBe(createRequestFingerprint(command));
  });
});
