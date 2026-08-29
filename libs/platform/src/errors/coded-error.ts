/**
 * The base every failure in this system extends.
 *
 * Two facts travel with the error itself rather than being re-derived by each
 * consumer of it:
 *
 * - `code` is the stable identifier. Messages are for humans and change freely;
 *   the code is what the HTTP layer maps to a status and what logs are queried
 *   by, so it is part of the public contract.
 * - `retryable` answers "could running this again succeed?". It is the author
 *   of the failure who knows, not the Kafka consumer — which previously kept a
 *   hand-copied set of code *strings* from libraries it does not import, so a
 *   renamed code silently became retryable and a new one silently retried five
 *   times before dead-lettering.
 *
 * Domain and application failures default to non-retryable because they are
 * deterministic: the same input produces the same rejection. Infrastructure
 * failures are the opposite, which is why {@link isRetryable} treats anything
 * that is *not* a `CodedError` as worth retrying.
 */
export abstract class CodedError extends Error {
  abstract readonly code: string;

  readonly retryable: boolean = false;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    // Derived from the class rather than restated as a literal in all
    // twenty-three subclasses, where it was one copy-paste away from naming a
    // different error than the one being thrown. Safe here because the bundle
    // is built with `optimization: false`; under a minifier this degrades to a
    // mangled name in logs, never to incorrect behaviour, since every decision
    // is made on `code`.
    this.name = new.target.name;
  }
}

/**
 * The `code` literals of a set of error classes, as a union.
 *
 * Written against the classes rather than a second list of strings, so the
 * union cannot drift from the errors it claims to describe. Each library
 * assembles its own; the union is composed at the edge that needs to be
 * exhaustive over all of them.
 */
export type ErrorCodeOf<
  Class extends abstract new (...args: never[]) => CodedError,
> = InstanceType<Class>['code'];

export function isCodedError(value: unknown): value is CodedError {
  return value instanceof CodedError;
}

/**
 * A failure is retryable when it says so, or when it is not ours — a pool
 * timeout, a broker hiccup, a socket reset. Those are exactly the transient
 * conditions redelivery exists for.
 */
export function isRetryable(value: unknown): boolean {
  return isCodedError(value) ? value.retryable : true;
}
