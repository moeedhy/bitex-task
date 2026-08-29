import { WithdrawalAddress } from '../../domain/withdrawal-address.js';
import type { RequestWithdrawalCommand } from './request-withdrawal.contract.js';

/**
 * Canonical representation of everything that makes two withdrawal requests
 * *the same request*.
 *
 * This lives in the application layer, not in a driving adapter, for three
 * reasons:
 *
 * - the rule is workflow policy, so every entry point (HTTP today, anything
 *   else later) must produce identical output for identical intent;
 * - it is derived from parsed values, so `100`, `100.0` and `100.000000` all
 *   collapse to the same atomic amount, and the destination is normalised by
 *   the same value object the aggregate stores;
 * - it is a readable string rather than a digest, so a production conflict can
 *   be diagnosed by reading the stored row.
 *
 * Fields are length-prefixed rather than delimiter-joined because `userId` and
 * the destination address are caller-supplied: no separator character is
 * guaranteed to be absent from them, but a length prefix is unambiguous for
 * any content.
 *
 * Volatile data (correlation ids, timestamps, headers) is deliberately absent:
 * a retry of the same intent must fingerprint identically.
 */
export function createRequestFingerprint(
  command: RequestWithdrawalCommand,
): string {
  return [
    'REQUEST_WITHDRAWAL.v1',
    ...[
      command.userId,
      command.amount.asset.code,
      command.amount.toAtomicUnits().toString(),
      WithdrawalAddress.create(command.destinationAddress).value,
    ].map((field) => `${field.length}:${field}`),
  ].join('|');
}
