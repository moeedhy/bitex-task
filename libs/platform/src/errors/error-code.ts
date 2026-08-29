import type {
  AssetMismatchError,
  InvalidAssetError,
  InvalidMoneyAmountError,
  MoneyPrecisionExceededError,
  UnsupportedAssetError,
} from '../money/money.errors.js';
import type { InvalidIdentityError } from '../identity/uuid.js';
import type { ErrorCodeOf } from './coded-error.js';

/**
 * Every code this library can raise.
 *
 * Written against the error *classes*, not a second list of string literals, so
 * a renamed code is a compile error here rather than a silently unmapped 500 at
 * the HTTP edge. Each library exports its own union; the edge that must handle
 * all of them composes them and is checked for exhaustiveness.
 */
export type PlatformErrorCode = ErrorCodeOf<
  | typeof InvalidAssetError
  | typeof UnsupportedAssetError
  | typeof InvalidMoneyAmountError
  | typeof MoneyPrecisionExceededError
  | typeof AssetMismatchError
  | typeof InvalidIdentityError
>;
