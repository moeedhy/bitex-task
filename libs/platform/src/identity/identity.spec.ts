import {
  EventId,
  identity,
  InvalidIdentityError,
  isUuid,
  parseUuid,
  ReservationId,
  UserId,
  uuidV7Generator,
  WithdrawalId,
} from './index.js';

describe('identity', () => {
  const canonical = '018f8b2a-3c4d-7e5f-8a9b-0c1d2e3f4a5b';

  describe('parsing', () => {
    it('accepts a canonical UUID', () => {
      expect(WithdrawalId.parse(canonical)).toBe(canonical);
    });

    /**
     * Rows written before UUIDv7 hold v4 values. Validating the version rather
     * than the layout would reject the service's own history.
     */
    it('accepts a v4 UUID, not only v7', () => {
      const v4 = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

      expect(WithdrawalId.parse(v4)).toBe(v4);
    });

    /**
     * PostgreSQL renders `uuid` columns lowercase. An uppercase copy is the
     * same row but a different string, so `Set`s, map keys and equality checks
     * would disagree with the database.
     */
    it('normalises case so one identity has one representation', () => {
      expect(UserId.parse(canonical.toUpperCase())).toBe(canonical);
    });

    it.each([
      ['a blank string', '   '],
      ['the old style of identifier', 'user-123'],
      ['a truncated UUID', '018f8b2a-3c4d-7e5f-8a9b'],
      ['a UUID with a non-hex character', '018f8b2a-3c4d-7e5f-8a9b-0c1d2e3f4azz'],
      ['a number', 42],
      ['null', null],
      ['undefined', undefined],
    ])('rejects %s', (_label, raw) => {
      expect(() => UserId.parse(raw)).toThrow(InvalidIdentityError);
    });

    it('names the identity it was parsing so the failure is diagnosable', () => {
      expect(() => ReservationId.parse('nope')).toThrow(
        'ReservationId must be a UUID.',
      );
    });

    it('reports a non-retryable failure: the same input fails identically', () => {
      const error = new InvalidIdentityError('UserId', 'nope');

      expect(error.retryable).toBe(false);
      expect(error.code).toBe('INVALID_IDENTITY');
      expect(error.name).toBe('InvalidIdentityError');
    });
  });

  describe('isUuid', () => {
    it('narrows without throwing', () => {
      expect(isUuid(canonical)).toBe(true);
      expect(isUuid('user-123')).toBe(false);
      expect(isUuid(undefined)).toBe(false);
    });
  });

  describe('uuidV7Generator', () => {
    it('mints identities the parsers accept', () => {
      const id = uuidV7Generator<'WithdrawalId'>().next();

      expect(() => WithdrawalId.parse(id)).not.toThrow();
    });

    it('mints distinct identities', () => {
      const ids = uuidV7Generator<'EventId'>();
      const minted = new Set(Array.from({ length: 500 }, () => ids.next()));

      expect(minted.size).toBe(500);
    });

    /**
     * The reason for choosing v7 over v4: the leading 48 bits are a millisecond
     * timestamp, so keys sort by creation time and inserts stay on the right
     * edge of the primary key's B-tree instead of scattering across it.
     */
    it('mints identities that sort by creation order', () => {
      const ids = uuidV7Generator<'EventId'>();
      const minted = Array.from({ length: 200 }, () => ids.next());

      expect([...minted].sort()).toEqual(minted);
    });

    it('sets the version and variant bits v7 requires', () => {
      const id = uuidV7Generator<'EventId'>().next();

      expect(id[14]).toBe('7');
      expect('89ab').toContain(id[19]);
    });
  });

  describe('brands', () => {
    /**
     * The brand is a compile-time fiction; nothing survives to runtime. The
     * value of these identities is that `settle(reservationId, withdrawalId)`
     * can no longer be called with its arguments swapped, and that is checked
     * by `typecheck`, not here.
     */
    it('adds nothing to the value at runtime', () => {
      expect(typeof EventId.parse(canonical)).toBe('string');
      expect(EventId.parse(canonical)).toEqual(canonical);
    });

    it('exposes the label it was built with', () => {
      expect(identity('WalletId').label).toBe('WalletId');
      expect(parseUuid(canonical, 'WalletId')).toBe(canonical);
    });
  });
});
