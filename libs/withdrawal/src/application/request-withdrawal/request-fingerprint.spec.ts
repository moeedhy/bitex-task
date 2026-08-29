import { Assets, Money } from '@bitex/platform';
import { createRequestFingerprint } from './request-fingerprint.js';
import { UserId } from '@bitex/platform';

// Fixed identities. Parsed rather than cast, so the fixtures are
// exactly what the production edges accept.
const USER_ID = UserId.parse('22222222-2222-4222-8222-222222222222');
const OTHER_USER_ID = UserId.parse('22222222-2222-4222-8222-222222222456');

describe('createRequestFingerprint', () => {
  const command = {
    idempotencyKey: 'key-123',
    userId: USER_ID,
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
    ['user', { userId: OTHER_USER_ID }],
    ['amount', { amount: Money.parse('100.000001', Assets.USDT) }],
    ['destination', { destinationAddress: 'TOTHER987654321' }],
  ])('separates requests that differ by %s', (_label, overrides) => {
    expect(createRequestFingerprint({ ...command, ...overrides })).not.toBe(
      createRequestFingerprint(command),
    );
  });

  /**
   * The netstring framing exists so that content cannot migrate between fields.
   * `userId` can no longer carry the delimiter now that it is a parsed UUID, so
   * the probe moved to `destinationAddress` -- a free-form, client-supplied
   * string, which is where the risk actually lives.
   */
  it('cannot be spoofed by moving content across field boundaries', () => {
    const shifted = createRequestFingerprint({
      ...command,
      destinationAddress: `${command.destinationAddress}|4:USDT`,
    });

    expect(shifted).not.toBe(createRequestFingerprint(command));
  });
});
