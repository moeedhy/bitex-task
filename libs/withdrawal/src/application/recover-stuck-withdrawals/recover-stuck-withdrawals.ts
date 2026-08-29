import type {
  Clock,
  IdGenerator,
  Outbox,
  TransactionRunner,
  UserId,
  WithdrawalId,
} from '@bitex/platform';

/**
 * The immutable facts needed to re-drive execution. Deliberately a read model
 * rather than the aggregate: recovery re-publishes an intent, it does not
 * mutate the Withdrawal.
 */
export interface StuckWithdrawal {
  withdrawalId: WithdrawalId;
  userId: UserId;
  asset: string;
  amount: string;
}

export interface StuckWithdrawalQueryPort {
  findProcessingSince(input: {
    threshold: Date;
    limit: number;
  }): Promise<StuckWithdrawal[]>;
}

export interface RecoverStuckWithdrawalsDependencies {
  transactionRunner: TransactionRunner;
  stuckWithdrawals: StuckWithdrawalQueryPort;
  outbox: Outbox;
  eventIdGenerator: IdGenerator<'EventId'>;
  clock: Clock;
  /** How long a Withdrawal may stay PROCESSING before it is re-driven. */
  processingTimeoutMs: number;
  batchSize: number;
}

/**
 * Closes the one gap that at-least-once delivery cannot close by itself.
 *
 * `ExecuteWithdrawal` commits PROCESSING, calls the provider outside any
 * transaction, then settles. Every crash in that window is recoverable *while
 * the Kafka message still exists* — but a message can stop existing: retention
 * expires, an operator resets offsets, or the consumer dead-letters it to
 * unblock a partition. Nothing then re-drives the withdrawal, and the caller's
 * funds stay reserved indefinitely.
 *
 * Recovery re-publishes the execution intent with a *fresh* event id. That is
 * intentional: the original event id may already sit in `processed_events`
 * semantics elsewhere, and suppressing the retry is the opposite of what is
 * wanted. Safety comes from the two guards that already exist rather than from
 * deduplication — `ExecuteWithdrawal` refuses to re-settle a terminal
 * Withdrawal, and the provider is idempotent on `withdrawalId`.
 */
export class RecoverStuckWithdrawals {
  constructor(
    private readonly dependencies: RecoverStuckWithdrawalsDependencies,
  ) {}

  execute(): Promise<{ rescheduled: WithdrawalId[] }> {
    return this.dependencies.transactionRunner.run(async () => {
      const now = this.dependencies.clock.now();
      const stuck = await this.dependencies.stuckWithdrawals.findProcessingSince(
        {
          threshold: new Date(
            now.getTime() - this.dependencies.processingTimeoutMs,
          ),
          limit: this.dependencies.batchSize,
        },
      );

      for (const withdrawal of stuck) {
        await this.dependencies.outbox.append({
          id: this.dependencies.eventIdGenerator.next(),
          type: 'WithdrawalExecutionRequested',
          aggregateId: withdrawal.withdrawalId,
          occurredAt: now,
          payload: {
            withdrawalId: withdrawal.withdrawalId,
            userId: withdrawal.userId,
            asset: withdrawal.asset,
            amount: withdrawal.amount,
          },
        });
      }

      return { rescheduled: stuck.map((item) => item.withdrawalId) };
    });
  }
}
