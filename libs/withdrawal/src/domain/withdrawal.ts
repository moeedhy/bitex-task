import type { Asset, Money } from '@bitex/platform';
import { WithdrawalAddress } from './withdrawal-address.js';
import {
  InvalidWithdrawalError,
  InvalidWithdrawalTransitionError,
} from './withdrawal.errors.js';

export type WithdrawalStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED';

export type WithdrawalFailureReason = 'PROVIDER_ERROR';

export interface WithdrawalSnapshot {
  id: string;
  userId: string;
  amount: Money;
  destinationAddress: WithdrawalAddress;
  reservationId: string;
  status: WithdrawalStatus;
  transactionReference?: string;
  failureReason?: WithdrawalFailureReason;
  createdAt: Date;
  updatedAt: Date;
}

interface RequestWithdrawalInput {
  id: string;
  userId: string;
  amount: Money;
  destinationAddress: string;
  reservationId: string;
  createdAt: Date;
}

export class Withdrawal {
  private readonly state: WithdrawalSnapshot;

  private constructor(state: WithdrawalSnapshot) {
    this.state = {
      ...state,
      createdAt: new Date(state.createdAt),
      updatedAt: new Date(state.updatedAt),
    };
  }

  static request(input: RequestWithdrawalInput): Withdrawal {
    Withdrawal.assertIdentity(input.id, 'Withdrawal');
    Withdrawal.assertIdentity(input.userId, 'User');
    Withdrawal.assertIdentity(input.reservationId, 'Reservation');
    if (!input.amount.isPositive()) {
      throw new InvalidWithdrawalError(
        'Withdrawal amount must be greater than zero.',
      );
    }
    return new Withdrawal({
      ...input,
      destinationAddress: WithdrawalAddress.create(input.destinationAddress),
      status: 'PENDING',
      updatedAt: input.createdAt,
    });
  }

  static reconstitute(snapshot: WithdrawalSnapshot): Withdrawal {
    Withdrawal.assertIdentity(snapshot.id, 'Withdrawal');
    Withdrawal.assertIdentity(snapshot.userId, 'User');
    Withdrawal.assertIdentity(snapshot.reservationId, 'Reservation');
    if (!snapshot.amount.isPositive()) {
      throw new InvalidWithdrawalError(
        'Withdrawal amount must be greater than zero.',
      );
    }
    Withdrawal.assertState(snapshot);
    return new Withdrawal({ ...snapshot });
  }

  get id(): string {
    return this.state.id;
  }

  get userId(): string {
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
    return new Date(this.state.createdAt);
  }

  get updatedAt(): Date {
    return new Date(this.state.updatedAt);
  }

  startProcessing(now = new Date()): void {
    this.transitionFrom('PENDING', 'PROCESSING');
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
    if (reason !== 'PROVIDER_ERROR') {
      throw new InvalidWithdrawalError('Unknown withdrawal failure reason.');
    }
    this.transitionFrom('PROCESSING', 'FAILED');
    this.state.failureReason = reason;
    this.state.updatedAt = now;
  }

  toSnapshot(): WithdrawalSnapshot {
    return {
      ...this.state,
      createdAt: new Date(this.state.createdAt),
      updatedAt: new Date(this.state.updatedAt),
    };
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

  private static assertState(snapshot: WithdrawalSnapshot): void {
    if (snapshot.status === 'COMPLETED') {
      if (!snapshot.transactionReference?.trim() || snapshot.failureReason) {
        throw new InvalidWithdrawalError(
          'A completed withdrawal requires only a provider reference.',
        );
      }
      return;
    }
    if (snapshot.status === 'FAILED') {
      if (
        snapshot.failureReason !== 'PROVIDER_ERROR' ||
        snapshot.transactionReference
      ) {
        throw new InvalidWithdrawalError(
          'A failed withdrawal requires only a failure reason.',
        );
      }
      return;
    }
    if (!['PENDING', 'PROCESSING'].includes(snapshot.status)) {
      throw new InvalidWithdrawalError(
        `Unknown withdrawal status "${String(snapshot.status)}".`,
      );
    }
    if (snapshot.transactionReference || snapshot.failureReason) {
      throw new InvalidWithdrawalError(
        'A non-terminal withdrawal cannot contain terminal result data.',
      );
    }
  }

  private static assertIdentity(value: string, label: string): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new InvalidWithdrawalError(`${label} identity is required.`);
    }
  }
}
