import { Asset, Money } from '@bitex/platform';
import {
  InvalidWithdrawalError,
  InvalidWithdrawalTransitionError,
} from './withdrawal.errors.js';

export type WithdrawalStatus =
  | 'FUNDS_RESERVED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED';

export type WithdrawalFailureReason = 'PROVIDER_ERROR';

export interface WithdrawalSnapshot {
  id: string;
  userId: string;
  asset: Asset;
  amount: Money;
  destinationAddress: string;
  reservationId: string;
  status: WithdrawalStatus;
  transactionReference?: string;
  failureReason?: WithdrawalFailureReason;
  createdAt: Date;
  updatedAt: Date;
}

export class Withdrawal {
  private constructor(private readonly state: WithdrawalSnapshot) {}

  static request(
    input: Omit<WithdrawalSnapshot, 'status' | 'updatedAt'>,
  ): Withdrawal {
    if (!input.amount.isPositive()) {
      throw new InvalidWithdrawalError(
        'Withdrawal amount must be greater than zero.',
      );
    }
    if (input.destinationAddress.trim().length === 0) {
      throw new InvalidWithdrawalError('Destination address is required.');
    }

    return new Withdrawal({
      ...input,
      destinationAddress: input.destinationAddress.trim(),
      status: 'FUNDS_RESERVED',
      updatedAt: input.createdAt,
    });
  }

  static restore(snapshot: WithdrawalSnapshot): Withdrawal {
    return new Withdrawal({ ...snapshot });
  }

  get id(): string {
    return this.state.id;
  }
  get userId(): string {
    return this.state.userId;
  }
  get asset(): Asset {
    return this.state.asset;
  }
  get amount(): Money {
    return this.state.amount;
  }
  get destinationAddress(): string {
    return this.state.destinationAddress;
  }
  get reservationId(): string {
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
    return this.state.createdAt;
  }
  get updatedAt(): Date {
    return this.state.updatedAt;
  }

  startProcessing(now = new Date()): void {
    this.transitionFrom('FUNDS_RESERVED', 'PROCESSING');
    this.state.updatedAt = now;
  }

  complete(transactionReference: string, now = new Date()): void {
    const normalizedReference = transactionReference.trim();
    if (normalizedReference.length === 0) {
      throw new InvalidWithdrawalError(
        'Provider transaction reference is required.',
      );
    }
    this.transitionFrom('PROCESSING', 'COMPLETED');
    this.state.transactionReference = normalizedReference;
    this.state.updatedAt = now;
  }

  fail(reason: WithdrawalFailureReason, now = new Date()): void {
    this.transitionFrom('PROCESSING', 'FAILED');
    this.state.failureReason = reason;
    this.state.updatedAt = now;
  }

  toSnapshot(): WithdrawalSnapshot {
    return { ...this.state };
  }

  private transitionFrom(
    expected: WithdrawalStatus,
    target: WithdrawalStatus,
  ): void {
    if (this.state.status !== expected) {
      throw new InvalidWithdrawalTransitionError(this.state.status, target);
    }
    this.state.status = target;
  }
}
