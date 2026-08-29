import { token } from '@bitex/platform/nest';
import type { IdGenerator } from '@bitex/platform';
import type { ProcessedEventPort } from '../application/ports/processed-event.port.js';
import type { StuckWithdrawalQueryPort } from '../application/ports/stuck-withdrawal-query.port.js';
import type { WalletReservationPort } from '../application/ports/wallet-reservation.port.js';
import type { WalletSettlementPort } from '../application/ports/wallet-settlement.port.js';
import type { WithdrawalIdempotencyPort } from '../application/ports/withdrawal-idempotency.port.js';
import type { WithdrawalProvider } from '../application/ports/withdrawal-provider.port.js';
import type { WithdrawalQueryPort } from '../application/ports/withdrawal-query.port.js';
import type { WithdrawalRepository } from '../application/ports/withdrawal.repository.js';
import type { ExecuteWithdrawal } from '../application/execute-withdrawal/execute-withdrawal.js';
import type { GetWithdrawal } from '../application/get-withdrawal/get-withdrawal.js';
import type { RecoverStuckWithdrawals } from '../application/recover-stuck-withdrawals/recover-stuck-withdrawals.js';
import type { RequestWithdrawal } from '../application/request-withdrawal/request-withdrawal.js';

/**
 * Bound by the application: one token per port this context declares. The
 * tokens are the module's requirements, stated in one place, and a missing
 * binding is a container error naming the token rather than a silent
 * `undefined` dependency.
 */
export const WITHDRAWAL_REPOSITORY =
  token<WithdrawalRepository>('WithdrawalRepository');
export const WITHDRAWAL_QUERY = token<WithdrawalQueryPort>('WithdrawalQuery');
export const WITHDRAWAL_IDEMPOTENCY = token<WithdrawalIdempotencyPort>(
  'WithdrawalIdempotency',
);
export const PROCESSED_EVENTS = token<ProcessedEventPort>('ProcessedEvents');
export const STUCK_WITHDRAWAL_QUERY = token<StuckWithdrawalQueryPort>(
  'StuckWithdrawalQuery',
);
export const WITHDRAWAL_PROVIDER =
  token<WithdrawalProvider>('WithdrawalProvider');
export const WALLET_RESERVATION =
  token<WalletReservationPort>('WalletReservation');
export const WALLET_SETTLEMENT =
  token<WalletSettlementPort>('WalletSettlement');

/** Owned by this module. */
export const WITHDRAWAL_ID_GENERATOR =
  token<IdGenerator<'WithdrawalId'>>('WithdrawalIdGenerator');
export const EVENT_ID_GENERATOR =
  token<IdGenerator<'EventId'>>('EventIdGenerator');

/**
 * How long a Withdrawal may stay PROCESSING before recovery re-drives it, and
 * how many are re-driven per pass. Supplied by the application because they are
 * operational knobs, not rules.
 */
export interface WithdrawalRecoveryOptions {
  processingTimeoutMs: number;
  batchSize: number;
}

export const WITHDRAWAL_RECOVERY_OPTIONS = token<WithdrawalRecoveryOptions>(
  'WithdrawalRecoveryOptions',
);

/** Exported to whoever imports this module. */
export const REQUEST_WITHDRAWAL = token<RequestWithdrawal>('RequestWithdrawal');
export const EXECUTE_WITHDRAWAL = token<ExecuteWithdrawal>('ExecuteWithdrawal');
export const GET_WITHDRAWAL = token<GetWithdrawal>('GetWithdrawal');
export const RECOVER_STUCK_WITHDRAWALS = token<RecoverStuckWithdrawals>(
  'RecoverStuckWithdrawals',
);
