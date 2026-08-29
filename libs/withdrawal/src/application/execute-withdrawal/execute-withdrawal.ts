import { assertNever } from '@bitex/platform';
import type {
  Clock,
  EventId,
  ReservationId,
  TransactionRunner,
  WithdrawalId,
} from '@bitex/platform';
import { WithdrawalExecutionUnresolvedError } from '../withdrawal.errors.js';
import type { Withdrawal } from '../../domain/withdrawal.js';
import type { WithdrawalDomainEvent } from '../../domain/withdrawal.events.js';
import type { WithdrawalRepository } from '../ports/withdrawal.repository.js';
import type {
  ExecutionRequest,
  ExecutionResult,
  WithdrawalProvider,
} from './withdrawal.provider.js';

export interface ProcessedEventPort {
  has(eventId: EventId): Promise<boolean>;
  record(eventId: EventId): Promise<void>;
}

export interface WalletSettlementPort {
  finalize(reservationId: ReservationId): Promise<void>;
  release(reservationId: ReservationId): Promise<void>;
}

export interface ExecuteWithdrawalDependencies {
  transactionRunner: TransactionRunner;
  withdrawals: WithdrawalRepository;
  processedEvents: ProcessedEventPort;
  walletSettlement: WalletSettlementPort;
  provider: WithdrawalProvider;
  clock: Clock;
}

export interface ExecuteWithdrawalCommand {
  eventId: EventId;
  withdrawalId: WithdrawalId;
}

export class ExecuteWithdrawal {
  constructor(private readonly dependencies: ExecuteWithdrawalDependencies) {}

  async execute(command: ExecuteWithdrawalCommand): Promise<void> {
    const request = await this.prepare(command);
    if (!request) {
      return;
    }

    let result: ExecutionResult;
    try {
      result = await this.dependencies.provider.execute(request);
    } catch (cause) {
      // A transport failure is not a provider rejection: the transfer may have
      // happened. Leave the Withdrawal PROCESSING and the reservation ACTIVE so
      // redelivery re-drives the idempotent provider instead of releasing funds
      // that may already be gone.
      throw new WithdrawalExecutionUnresolvedError(command.withdrawalId, {
        cause,
      });
    }
    await this.settle(command, result);
  }

  private prepare(
    command: ExecuteWithdrawalCommand,
  ): Promise<ExecutionRequest | null> {
    return this.dependencies.transactionRunner.run(async () => {
      const withdrawal = await this.loadSettleable(command);
      if (!withdrawal) {
        return null;
      }
      if (withdrawal.status === 'PENDING') {
        withdrawal.startProcessing(this.dependencies.clock.now());
        await this.dependencies.withdrawals.save(withdrawal);
      }

      return {
        withdrawalId: withdrawal.id,
        amount: withdrawal.amount.toDecimalString(),
        asset: withdrawal.asset.code,
        destinationAddress: withdrawal.destinationAddress.value,
      };
    });
  }

  /**
   * The guard both transactions share: skip an event already processed, and
   * skip a withdrawal that has already reached an outcome -- recording the
   * event either way so redelivery stops.
   *
   * `null` means "nothing left to do", not "something went wrong". This was
   * duplicated verbatim across `prepare` and `settle`, terminality included, so
   * the two could disagree.
   */
  private async loadSettleable(
    command: ExecuteWithdrawalCommand,
  ): Promise<Withdrawal | null> {
    if (await this.dependencies.processedEvents.has(command.eventId)) {
      return null;
    }
    const withdrawal = await this.dependencies.withdrawals.getForUpdate(
      command.withdrawalId,
    );
    if (withdrawal.isTerminal()) {
      await this.dependencies.processedEvents.record(command.eventId);
      return null;
    }
    return withdrawal;
  }

  /**
   * Discharges what the aggregate said it owed.
   *
   * Invariant 5.8 -- a failed withdrawal releases its reservation -- is no
   * longer an `if`/`else` that happens to be written correctly here. The
   * aggregate emits the obligation together with the reservation it concerns,
   * and this switch is exhaustive over that union: a new terminal state cannot
   * be added without deciding what becomes of the reserved funds.
   */
  private async settleReservation(
    events: readonly WithdrawalDomainEvent[],
  ): Promise<void> {
    for (const event of events) {
      switch (event.type) {
        case 'WithdrawalCompleted':
          await this.dependencies.walletSettlement.finalize(
            event.reservationId,
          );
          break;
        case 'WithdrawalFailed':
          await this.dependencies.walletSettlement.release(event.reservationId);
          break;
        case 'WithdrawalExecutionRequested':
          // Published through the outbox by RequestWithdrawal; it settles
          // nothing and cannot be emitted by a transition reached from here.
          break;
        default:
          assertNever(event);
      }
    }
  }

  private settle(
    command: ExecuteWithdrawalCommand,
    result: ExecutionResult,
  ): Promise<void> {
    return this.dependencies.transactionRunner.run(async () => {
      const withdrawal = await this.loadSettleable(command);
      if (!withdrawal) {
        return;
      }

      const now = this.dependencies.clock.now();
      if (result.status === 'SUCCESS') {
        withdrawal.complete(result.transactionReference, now);
      } else {
        withdrawal.fail(result.reason, now);
      }

      await this.dependencies.withdrawals.save(withdrawal);
      await this.settleReservation(withdrawal.pullDomainEvents());
      await this.dependencies.processedEvents.record(command.eventId);
    });
  }
}
