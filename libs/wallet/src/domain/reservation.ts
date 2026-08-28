import { Money } from '@bitex/platform';
import { ReservationStateError } from './wallet.errors.js';

export type ReservationStatus = 'ACTIVE' | 'FINALIZED' | 'RELEASED';

export interface ReservationSnapshot {
  id: string;
  withdrawalId: string;
  amount: Money;
  status: ReservationStatus;
}

export class Reservation {
  private constructor(
    readonly id: string,
    readonly withdrawalId: string,
    readonly amount: Money,
    private currentStatus: ReservationStatus,
  ) {}

  static create(input: {
    id: string;
    withdrawalId: string;
    amount: Money;
  }): Reservation {
    return new Reservation(
      input.id,
      input.withdrawalId,
      input.amount,
      'ACTIVE',
    );
  }

  static restore(snapshot: ReservationSnapshot): Reservation {
    return new Reservation(
      snapshot.id,
      snapshot.withdrawalId,
      snapshot.amount,
      snapshot.status,
    );
  }

  get status(): ReservationStatus {
    return this.currentStatus;
  }

  finalize(): void {
    this.assertActive('finalize');
    this.currentStatus = 'FINALIZED';
  }

  release(): void {
    this.assertActive('release');
    this.currentStatus = 'RELEASED';
  }

  toSnapshot(): ReservationSnapshot {
    return {
      id: this.id,
      withdrawalId: this.withdrawalId,
      amount: this.amount,
      status: this.currentStatus,
    };
  }

  private assertActive(action: string): void {
    if (this.currentStatus !== 'ACTIVE') {
      throw new ReservationStateError(this.id, this.currentStatus, action);
    }
  }
}
