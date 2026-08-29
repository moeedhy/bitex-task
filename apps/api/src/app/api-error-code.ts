import type {
  PlatformErrorCode,
  ErrorCodeOf,
} from '@bitex/platform';
import type {
  WalletApplicationErrorCode,
  WalletDomainErrorCode,
} from '@bitex/wallet';
import type {
  WithdrawalApplicationErrorCode,
  WithdrawalDomainErrorCode,
} from '@bitex/withdrawal';
import type { MissingTransactionError } from '../infrastructure/shared/postgres-transaction-runner.js';
import type { StaleWriteError } from '../infrastructure/shared/stale-write.js';
import type { CorruptIdempotencyRecordError } from '../infrastructure/withdrawal/postgres-idempotency.js';

/**
 * Failures raised by this application's own adapters, as opposed to by the
 * libraries or by a driver.
 */
type AdapterErrorCode = ErrorCodeOf<
  | typeof MissingTransactionError
  | typeof StaleWriteError
  | typeof CorruptIdempotencyRecordError
>;

/**
 * Codes the API is expected to have an answer for, assembled from each
 * library's own union.
 *
 * The composition happens here, at the only layer that legitimately knows about
 * all of them — no library learns about another, and platform does not learn
 * about either. What this buys is in `api-exception.filter.ts`: the status
 * table is a `Record` over this union, so adding an error class without
 * deciding its HTTP status fails `typecheck` instead of shipping a 500.
 *
 * Errors from outside this union — a `pg` timeout, a kafkajs socket error —
 * are not enumerable and are deliberately not listed. They fall through to a
 * 500 with a redacted message.
 */
export type ApiErrorCode =
  | PlatformErrorCode
  | WalletDomainErrorCode
  | WalletApplicationErrorCode
  | WithdrawalDomainErrorCode
  | WithdrawalApplicationErrorCode
  | AdapterErrorCode
  | TransportErrorCode;

/**
 * Codes the HTTP layer itself raises, before any use case is reached.
 */
export type TransportErrorCode =
  | 'INVALID_REQUEST'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'RATE_LIMIT_EXCEEDED';
