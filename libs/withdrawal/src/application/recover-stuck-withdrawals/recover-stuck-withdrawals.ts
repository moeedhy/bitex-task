import { resolveAsset, Money } from '@bitex/platform';
import type {
  Clock,
  IdGenerator,
  Outbox,
  TransactionRunner,
  WithdrawalId,
} from '@bitex/platform';
import { withdrawalExecutionRequested } from '../../contracts/withdrawal-execution-requested.js';
import type {
  StuckWithdrawal,
  StuckWithdrawalQueryPort,
} from '../ports/stuck-withdrawal-query.port.js';

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
        await this.dependencies.outbox.append(
          withdrawalExecutionRequested(
            toRequestedEvent(withdrawal, now),
            this.dependencies.eventIdGenerator.next(),
          ),
        );
      }

      return { rescheduled: stuck.map((item) => item.withdrawalId) };
    });
  }
}

/**
 * Recovery works from a read model, not from the aggregate, so it rebuilds the
 * one domain event the contract is derived from.
 *
 * The alternative — a second hand-written payload — is exactly what this phase
 * removed: the two build sites drifted silently because only one of them was
 * covered by the contract test.
 */
function toRequestedEvent(
  withdrawal: StuckWithdrawal,
  occurredAt: Date,
): Parameters<typeof withdrawalExecutionRequested>[0] {
  const asset = resolveAsset(withdrawal.asset);
  return {
    type: 'WithdrawalExecutionRequested',
    withdrawalId: withdrawal.withdrawalId,
    userId: withdrawal.userId,
    asset,
    amount: Money.parse(withdrawal.amount, asset),
    occurredAt,
  };
}
