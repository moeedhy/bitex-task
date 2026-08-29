import { WithdrawalId } from '@bitex/platform';
import { isWithdrawalStatus } from '@bitex/withdrawal';
import type { RequestWithdrawalResult } from '@bitex/withdrawal';

/**
 * The durable form of a completed idempotent request.
 *
 * `RequestWithdrawalResult` previously served three roles at once: the use
 * case's return value, the HTTP response body, and the `response_payload` JSONB
 * column read back on every replay. That meant any change to the workflow's
 * result — a new field, a renamed one — was silently a change to a stored
 * format that rows already on disk do not have, and to a wire contract clients
 * already parse.
 *
 * Three roles, three types. This one carries `version` so a future shape can be
 * recognised rather than misread, and it is the only one that must stay
 * backward-compatible with data.
 */
export interface StoredIdempotentResponse {
  version: 1;
  withdrawalId: string;
  status: string;
  asset: string;
  amount: string;
}

export const STORED_RESPONSE_VERSION = 1;

export function toStoredResponse(
  result: RequestWithdrawalResult,
): StoredIdempotentResponse {
  return {
    version: STORED_RESPONSE_VERSION,
    withdrawalId: result.withdrawalId,
    status: result.status,
    asset: result.asset,
    amount: result.amount,
  };
}

/**
 * Rebuilt field by field rather than returned as stored: `jsonb` does not
 * preserve key order, so echoing the raw column would make a replay logically
 * identical but byte-different from the original response.
 *
 * Returns `null` for anything this build cannot faithfully reproduce — a
 * missing version (written before versioning), a newer one, or a status this
 * build does not know. The caller turns that into an integrity alarm rather
 * than answering with a half-understood record.
 */
export function fromStoredResponse(
  stored: unknown,
): RequestWithdrawalResult | null {
  if (typeof stored !== 'object' || stored === null) {
    return null;
  }
  const record = stored as Partial<StoredIdempotentResponse>;
  if (record.version !== STORED_RESPONSE_VERSION) {
    return null;
  }
  if (
    typeof record.withdrawalId !== 'string' ||
    typeof record.asset !== 'string' ||
    typeof record.amount !== 'string' ||
    !isWithdrawalStatus(record.status)
  ) {
    return null;
  }
  return {
    withdrawalId: WithdrawalId.parse(record.withdrawalId),
    status: record.status,
    asset: record.asset,
    amount: record.amount,
  };
}
