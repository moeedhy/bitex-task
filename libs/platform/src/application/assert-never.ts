/**
 * Exhaustiveness guard for discriminated unions.
 *
 * Adding a variant to a union that is switched on without handling it becomes a
 * compile error here rather than a silently ignored case at runtime.
 */
export function assertNever(value: never): never {
  throw new Error(
    `Unhandled discriminated union member: ${JSON.stringify(value)}`,
  );
}
