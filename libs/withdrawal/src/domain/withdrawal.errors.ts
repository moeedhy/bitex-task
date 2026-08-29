import { CodedError } from '@bitex/platform';
import type { ErrorCodeOf } from '@bitex/platform';

export class InvalidWithdrawalError extends CodedError {
  readonly code = 'INVALID_WITHDRAWAL' as const;

  constructor(message: string) {
    super(message);
  }
}

export class InvalidWithdrawalAddressError extends CodedError {
  readonly code = 'INVALID_WITHDRAWAL_ADDRESS' as const;

  constructor(message = 'Withdrawal destination address is invalid.') {
    super(message);
  }
}

export class InvalidWithdrawalTransitionError extends CodedError {
  readonly code = 'INVALID_WITHDRAWAL_TRANSITION' as const;

  constructor(
    readonly currentStatus: string,
    readonly targetStatus: string,
  ) {
    super(
      `Cannot transition withdrawal from ${currentStatus} to ${targetStatus}.`,
    );
  }
}

export type WithdrawalDomainErrorCode = ErrorCodeOf<
  | typeof InvalidWithdrawalError
  | typeof InvalidWithdrawalAddressError
  | typeof InvalidWithdrawalTransitionError
>;
