import { isUuid, parseUuid } from './uuid.js';
import type { Uuid } from './uuid.js';

/**
 * The parsing half of an identity. Paired with a type alias of the same name so
 * that `UserId` reads as both the type and the way to obtain one:
 *
 * ```ts
 * const userId: UserId = UserId.parse(request.params.userId);
 * ```
 *
 * This replaces the three private `assertIdentity` statics that each aggregate
 * carried — identical checks throwing two different error types, none of which
 * narrowed anything, all of which accepted `"  "` as a wallet id because they
 * tested for a non-empty string rather than for an identifier.
 */
export interface Identity<Name extends string> {
  readonly label: Name;
  parse(raw: unknown): Uuid<Name>;
  is(raw: unknown): raw is Uuid<Name>;
}

export function identity<Name extends string>(label: Name): Identity<Name> {
  return {
    label,
    parse: (raw) => parseUuid(raw, label),
    is: (raw): raw is Uuid<Name> => isUuid(raw),
  };
}

/**
 * Identities that cross a context boundary, so no single module may own them.
 * A context-private identity (`WalletId`) is declared by the library that owns
 * its aggregate.
 */

export type UserId = Uuid<'UserId'>;
export const UserId = identity('UserId');

export type WithdrawalId = Uuid<'WithdrawalId'>;
export const WithdrawalId = identity('WithdrawalId');

export type ReservationId = Uuid<'ReservationId'>;
export const ReservationId = identity('ReservationId');

export type EventId = Uuid<'EventId'>;
export const EventId = identity('EventId');
