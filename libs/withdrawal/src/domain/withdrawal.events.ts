import type {
  Asset,
  Money,
  ReservationId,
  UserId,
  WithdrawalId,
} from '@bitex/platform';
import type { WithdrawalFailureReason } from './withdrawal-status.js';

/**
 * What the aggregate says happened, in its own vocabulary.
 *
 * These are *domain* events, not the wire format: they carry `Money` and
 * `Asset`, not decimal strings, and nothing outside this library sees them. The
 * integration event published to Kafka is derived from one of them, by the
 * contract in `src/contracts`, which is the only place the two shapes meet.
 *
 * Their reason for existing is invariant 5.8 of the brief -- "a failed
 * withdrawal must release its reservation". That used to be an `if`/`else` in
 * an application service, which meant the rule was true because one method
 * happened to be written correctly. Emitting `WithdrawalFailed` *with the
 * reservation it stranded* makes the obligation part of what the aggregate
 * asserts, and the handler that discharges it is exhaustive over this union --
 * so a new terminal state cannot be added without deciding what happens to the
 * reserved funds.
 */

export interface WithdrawalExecutionRequested {
  readonly type: 'WithdrawalExecutionRequested';
  readonly withdrawalId: WithdrawalId;
  readonly userId: UserId;
  readonly asset: Asset;
  readonly amount: Money;
  readonly occurredAt: Date;
}

export interface WithdrawalCompleted {
  readonly type: 'WithdrawalCompleted';
  readonly withdrawalId: WithdrawalId;
  /** The reservation this withdrawal must now capture. */
  readonly reservationId: ReservationId;
  readonly transactionReference: string;
  readonly occurredAt: Date;
}

export interface WithdrawalFailed {
  readonly type: 'WithdrawalFailed';
  readonly withdrawalId: WithdrawalId;
  /** The reservation this withdrawal must now release. */
  readonly reservationId: ReservationId;
  readonly reason: WithdrawalFailureReason;
  readonly occurredAt: Date;
}

export type WithdrawalDomainEvent =
  | WithdrawalExecutionRequested
  | WithdrawalCompleted
  | WithdrawalFailed;
