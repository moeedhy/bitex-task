/**
 * Turning an unknown thrown value into something worth putting in a log line.
 *
 * Logging `(error as Error).name` alone — which several adapters used to do —
 * produces the literal string `"error"` for every `pg` failure and a generic
 * class name for every kafkajs one, so a production incident arrives as an
 * indistinguishable token with no message, no driver code, and nothing to
 * correlate. The code and the message are both needed to tell "connection
 * refused" apart from "duplicate key".
 *
 * These will be superseded for domain failures by the `CodedError` base class,
 * which carries a typed `code`. They remain the fallback for the driver and
 * transport errors that will never extend it.
 */
export function errorCode(error: unknown): string {
  const candidate = error as { code?: unknown; name?: unknown };
  if (typeof candidate?.code === 'string') {
    return candidate.code;
  }
  return typeof candidate?.name === 'string' ? candidate.name : 'UNKNOWN_ERROR';
}

export function errorMessage(error: unknown): string {
  const candidate = error as { message?: unknown };
  return typeof candidate?.message === 'string'
    ? candidate.message
    : String(error);
}
