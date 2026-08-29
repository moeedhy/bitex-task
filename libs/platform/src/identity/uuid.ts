import { CodedError } from '../errors/coded-error.js';
import type { Brand } from './brand.js';

/**
 * A UUID that only fits where its own name fits.
 *
 * `Uuid<'WithdrawalId'>` and `Uuid<'ReservationId'>` are both strings at
 * runtime and neither is assignable to the other at compile time, which is the
 * whole point: `settle(reservationId, withdrawalId)` used to accept its own
 * arguments in either order.
 */
export type Uuid<Name extends string> = Brand<string, Name>;

/**
 * Deliberately matches *any* RFC 4122 layout, not just version 7.
 *
 * New identifiers are minted as UUIDv7 for the index locality that time-ordered
 * keys buy. Rows written before that change hold v4 values and are still
 * perfectly valid identities, so validating the version here would reject the
 * service's own history.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidIdentityError extends CodedError {
  readonly code = 'INVALID_IDENTITY' as const;

  constructor(
    readonly label: string,
    readonly received: unknown,
  ) {
    super(`${label} must be a UUID.`);
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * Parses at a system edge — an HTTP path parameter, a Kafka payload, a database
 * row — and normalises case, because PostgreSQL renders `uuid` columns in
 * lowercase and an uppercase copy of the same identity would compare unequal as
 * a string while being the same row.
 */
export function parseUuid<Name extends string>(
  raw: unknown,
  label: Name,
): Uuid<Name> {
  if (!isUuid(raw)) {
    throw new InvalidIdentityError(label, raw);
  }
  return raw.toLowerCase() as Uuid<Name>;
}
