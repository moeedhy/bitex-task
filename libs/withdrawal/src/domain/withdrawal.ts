import { assertNever } from '@bitex/platform';
import type {
  Asset,
  Money,
  ReservationId,
  UserId,
  WithdrawalId,
} from '@bitex/platform';
import { WithdrawalAddress } from './withdrawal-address.js';
import type { WithdrawalDomainEvent } from './withdrawal.events.js';
import {
  isTerminalWithdrawalStatus,
  isWithdrawalFailureReason,
  isWithdrawalStatus,
} from './withdrawal-status.js';
import type {
  WithdrawalFailureReason,
  WithdrawalStatus,
} from './withdrawal-status.js';
import {
  InvalidWithdrawalError,
  InvalidWithdrawalTransitionError,
} from './withdrawal.errors.js';

export interface WithdrawalSnapshot {
  id: WithdrawalId;
  userId: UserId;
  amount: Money;
  destinationAddress: WithdrawalAddress;
  reservationId: ReservationId;
  status: WithdrawalStatus;
  transactionReference?: string;
  failureReason?: WithdrawalFailureReason;
  createdAt: Date;
  updatedAt: Date;
}

interface RequestWithdrawalInput {
  id: WithdrawalId;
  userId: UserId;
  amount: Money;
  destinationAddress: string;
  reservationId: ReservationId;
  createdAt: Date;
}

export class Withdrawal {
  private state: WithdrawalSnapshot;

  private readonly events: WithdrawalDomainEvent[] = [];

  private constructor(state: WithdrawalSnapshot) {
    this.state = Withdrawal.copy(state);
  }

  static request(input: RequestWithdrawalInput): Withdrawal {
    Withdrawal.assertAmount(input.amount);

    const withdrawal = new Withdrawal({
      ...input,
      destinationAddress: WithdrawalAddress.create(input.destinationAddress),
      status: 'PENDING',
      updatedAt: input.createdAt,
    });
    withdrawal.events.push({
      type: 'WithdrawalExecutionRequested',
      withdrawalId: withdrawal.id,
      userId: withdrawal.userId,
      asset: withdrawal.asset,
      amount: withdrawal.amount,
      occurredAt: input.createdAt,
    });
    return withdrawal;
  }

  /**
   * Rebuilds from stored state. Emits nothing: reading a row is not something
   * that happened.
   */
  static reconstitute(snapshot: WithdrawalSnapshot): Withdrawal {
    Withdrawal.assertAmount(snapshot.amount);
    // The snapshot's *type* says the status is known, but it came from a
    // database row, so the type is a claim rather than a guarantee. This is the
    // only place that claim is checked; `assertState` below can then be
    // exhaustive over the union rather than defensive about it.
    if (!isWithdrawalStatus(snapshot.status)) {
      throw new InvalidWithdrawalError(
        `Unknown withdrawal status "${String(snapshot.status)}".`,
      );
    }
    Withdrawal.assertState(snapshot);
    return new Withdrawal(snapshot);
  }

  get id(): WithdrawalId {
    return this.state.id;
  }

  get userId(): UserId {
    return this.state.userId;
  }

  get asset(): Asset {
    return this.state.amount.asset;
  }

  get amount(): Money {
    return this.state.amount;
  }

  get destinationAddress(): WithdrawalAddress {
    return this.state.destinationAddress;
  }

  get reservationId(): ReservationId {
    return this.state.reservationId;
  }

  get status(): WithdrawalStatus {
    return this.state.status;
  }

  get transactionReference(): string | undefined {
    return this.state.transactionReference;
  }

  get failureReason(): WithdrawalFailureReason | undefined {
    return this.state.failureReason;
  }

  get createdAt(): Date {
    return new Date(this.state.createdAt);
  }

  get updatedAt(): Date {
    return new Date(this.state.updatedAt);
  }

  /**
   * Whether this withdrawal has already reached an outcome.
   *
   * The one place terminality is defined. Callers that need to know "is there
   * anything left to do here?" ask this instead of comparing statuses, so
   * adding a fifth status does not silently leave a stale comparison behind.
   */
  isTerminal(): boolean {
    return isTerminalWithdrawalStatus(this.state.status);
  }

  /**
   * Hands over the events recorded since the last drain, and forgets them.
   *
   * Draining rather than exposing is deliberate: the caller is expected to act
   * on each event exactly once, inside the transaction that persists the state
   * change that produced it.
   */
  pullDomainEvents(): WithdrawalDomainEvent[] {
    return this.events.splice(0, this.events.length);
  }

  startProcessing(now: Date): void {
    this.commit({
      ...this.transitioned('PENDING', 'PROCESSING'),
      updatedAt: now,
    });
  }

  complete(transactionReference: string, now: Date): void {
    const reference = transactionReference.trim();
    if (reference.length === 0) {
      throw new InvalidWithdrawalError(
        'Provider transaction reference is required.',
      );
    }

    this.commit({
      ...this.transitioned('PROCESSING', 'COMPLETED'),
      transactionReference: reference,
      updatedAt: now,
    });
    this.events.push({
      type: 'WithdrawalCompleted',
      withdrawalId: this.state.id,
      reservationId: this.state.reservationId,
      transactionReference: reference,
      occurredAt: now,
    });
  }

  fail(reason: WithdrawalFailureReason, now: Date): void {
    this.commit({
      ...this.transitioned('PROCESSING', 'FAILED'),
      failureReason: reason,
      updatedAt: now,
    });
    this.events.push({
      type: 'WithdrawalFailed',
      withdrawalId: this.state.id,
      reservationId: this.state.reservationId,
      reason,
      occurredAt: now,
    });
  }

  toSnapshot(): WithdrawalSnapshot {
    return Withdrawal.copy(this.state);
  }

  /**
   * Swaps in a candidate state only once it satisfies every invariant, matching
   * `WalletAccount`. In-place mutation left the aggregate half-changed when a
   * later assertion rejected it -- a status advanced with no reference set.
   */
  private commit(next: WithdrawalSnapshot): void {
    Withdrawal.assertState(next);
    this.state = Withdrawal.copy(next);
  }

  private transitioned(
    expected: WithdrawalStatus,
    target: WithdrawalStatus,
  ): WithdrawalSnapshot {
    if (this.state.status !== expected) {
      throw new InvalidWithdrawalTransitionError(this.state.status, target);
    }
    return { ...this.state, status: target };
  }

  private static assertAmount(amount: Money): void {
    if (!amount.isPositive()) {
      throw new InvalidWithdrawalError(
        'Withdrawal amount must be greater than zero.',
      );
    }
  }

  /**
   * Which result data each status is allowed to carry.
   *
   * A `switch` with `assertNever` rather than a chain of `if`s: adding a status
   * to `WITHDRAWAL_STATUSES` without deciding its shape here is a compile
   * error. The old form ended in a catch-all that simply accepted anything it
   * had not thought about.
   */
  private static assertState(snapshot: WithdrawalSnapshot): void {
    switch (snapshot.status) {
      case 'COMPLETED':
        if (!snapshot.transactionReference?.trim() || snapshot.failureReason) {
          throw new InvalidWithdrawalError(
            'A completed withdrawal requires only a provider reference.',
          );
        }
        return;
      case 'FAILED':
        if (
          !isWithdrawalFailureReason(snapshot.failureReason) ||
          snapshot.transactionReference
        ) {
          throw new InvalidWithdrawalError(
            'A failed withdrawal requires only a failure reason.',
          );
        }
        return;
      case 'PENDING':
      case 'PROCESSING':
        if (snapshot.transactionReference || snapshot.failureReason) {
          throw new InvalidWithdrawalError(
            'A non-terminal withdrawal cannot contain terminal result data.',
          );
        }
        return;
      default:
        return assertNever(snapshot.status);
    }
  }

  private static copy(state: WithdrawalSnapshot): WithdrawalSnapshot {
    return {
      ...state,
      createdAt: new Date(state.createdAt),
      updatedAt: new Date(state.updatedAt),
    };
  }
}
