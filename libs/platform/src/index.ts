/**
 * Shared kernel: the vocabulary every context speaks. Explicit named exports,
 * never `export *`, so what is shared is a decision rather than a side effect
 * of where a file happened to declare something.
 */

export { Asset } from './money/asset.js';
export { Assets, resolveAsset } from './money/assets.js';
export { Money } from './money/money.js';
export {
  AssetMismatchError,
  InvalidAssetError,
  InvalidMoneyAmountError,
  MoneyPrecisionExceededError,
  UnsupportedAssetError,
} from './money/money.errors.js';

export {
  EventId,
  identity,
  InvalidIdentityError,
  isUuid,
  parseUuid,
  ReservationId,
  UserId,
  uuidV7Generator,
  WithdrawalId,
} from './identity/index.js';
export type {
  Brand,
  Identity,
  IdGenerator,
  Uuid,
} from './identity/index.js';

export { CodedError, isCodedError, isRetryable } from './errors/index.js';
export { errorCode, errorMessage } from './errors/index.js';
export type { ErrorCodeOf, PlatformErrorCode } from './errors/index.js';

export { encodeIntegrationEvent } from './events/index.js';
export type {
  AnyIntegrationEvent,
  IntegrationEvent,
  IntegrationEventEnvelope,
} from './events/index.js';

export type { Clock, Outbox, TransactionRunner } from './application/ports.js';
export { assertNever } from './application/assert-never.js';
