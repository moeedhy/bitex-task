import type { RequestWithdrawalResult } from '../request-withdrawal/request-withdrawal.contract.js';

/**
 * Three outcomes, all of them expected protocol results rather than failures.
 *
 * `CONFLICT` is a return value, not an adapter-thrown exception, so the
 * workflow — not whichever storage happens to detect it — decides what a key
 * collision means.
 *
 * The concurrency semantics are part of *this* contract, not of the adapter
 * that happens to implement it today, and they were previously documented only
 * in the PostgreSQL adapter:
 *
 * - `CLAIMED` — this caller owns the operation and must carry it out.
 * - `REPLAY` — the operation already completed; return its recorded result
 *   without re-running anything.
 * - `CONFLICT` — the key was used for a request with different semantic
 *   content, so replaying it would answer for a different withdrawal.
 *
 * An implementation must serialise concurrent claims on the same key: exactly
 * one caller may receive `CLAIMED`, and the others must block until that
 * caller's transaction resolves rather than racing it.
 */
export type IdempotencyClaim =
  | { kind: 'CLAIMED' }
  | { kind: 'REPLAY'; result: RequestWithdrawalResult }
  | { kind: 'CONFLICT' };

export interface WithdrawalIdempotencyPort {
  claim(input: {
    operation: 'REQUEST_WITHDRAWAL';
    key: string;
    fingerprint: string;
  }): Promise<IdempotencyClaim>;
  complete(key: string, result: RequestWithdrawalResult): Promise<void>;
}
