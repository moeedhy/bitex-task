import { v7 } from 'uuid';
import type { Uuid } from './uuid.js';

/**
 * Minting is a dependency, not a global.
 *
 * Typed by the identity it produces, so an `IdGenerator<'EventId'>` cannot be
 * injected where withdrawal ids are expected. `RequestWithdrawal` already
 * declared two separate generators and was handed the same object twice; now
 * the distinction its constructor draws is one the type system enforces.
 */
export interface IdGenerator<Name extends string> {
  next(): Uuid<Name>;
}

/**
 * UUIDv7: the leading 48 bits are a millisecond timestamp, so generated keys
 * are monotonically increasing. That keeps inserts on the right-hand edge of
 * the primary key's B-tree instead of scattering them across it, which is the
 * difference between an index that stays dense and one that fragments — and it
 * makes `ORDER BY id` a usable proxy for creation order.
 */
export function uuidV7Generator<Name extends string>(): IdGenerator<Name> {
  return { next: () => v7() as Uuid<Name> };
}
