import { errorCode, EventId, isRetryable, WithdrawalId } from '@bitex/platform';
import { parseWithdrawalExecutionRequested } from '@bitex/withdrawal';
import type { ExecuteWithdrawal } from '@bitex/withdrawal';
import { Logger } from '@nestjs/common';
import type { Consumer } from 'kafkajs';

/*
 * Whether a failure is worth retrying is answered by `isRetryable`, which asks
 * the error. This file used to hold a hand-maintained set of eight code
 * *strings* harvested from two libraries it does not import: renaming a code
 * there silently made it retryable here, and every code nobody remembered to
 * add — an insufficient balance, an invalid amount — burned the full retry
 * budget re-deciding a verdict that could never change.
 */

export type DeadLetterReason =
  | 'UNPARSEABLE_MESSAGE'
  | 'NON_RETRYABLE_FAILURE'
  | 'RETRIES_EXHAUSTED';

export interface DeadLetterSink {
  send(record: {
    key: string | undefined;
    value: string;
    reason: DeadLetterReason;
    error: string;
  }): Promise<void>;
}

export interface ConsumerOptions {
  maxAttempts: number;
  backoffMs: number;
  sleep: (ms: number) => Promise<void>;
}

const DEFAULT_OPTIONS: ConsumerOptions = {
  maxAttempts: 5,
  backoffMs: 250,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Kafka is only the transport. The consumer parses, decides *whether* a failure
 * is worth retrying, and otherwise gets out of the way.
 *
 * A message that can never succeed is dead-lettered and its offset committed,
 * because the alternative — rethrowing forever — blocks every other withdrawal
 * on the partition behind one bad record. Dead-lettering is not the end of the
 * story for the money involved: a withdrawal left PROCESSING is picked up later
 * by `RecoverStuckWithdrawals`, which re-publishes the intent.
 */
export class WithdrawalExecutionConsumer {
  private readonly logger = new Logger(WithdrawalExecutionConsumer.name);
  private readonly options: ConsumerOptions;

  constructor(
    private readonly consumer: Consumer,
    private readonly topic: string,
    private readonly executeWithdrawal: Pick<ExecuteWithdrawal, 'execute'>,
    private readonly deadLetters: DeadLetterSink,
    options: Partial<ConsumerOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async start(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: this.topic, fromBeginning: false });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        await this.handle(
          message.key?.toString('utf8'),
          message.value?.toString('utf8') ?? '',
        );
      },
    });
  }

  async stop(): Promise<void> {
    await this.consumer.disconnect();
  }

  async handle(key: string | undefined, value: string): Promise<void> {
    // Parsed through the producer's own contract, so the two cannot drift.
    const parsed = parseWithdrawalExecutionRequested(this.parse(value));
    if (!parsed.success) {
      await this.deadLetter(key, value, 'UNPARSEABLE_MESSAGE', parsed.error);
      return;
    }
    const event = parsed.data;

    // Cannot throw: the contract's schema has already established that both
    // fields are UUIDs, so a malformed identity was dead-lettered above rather
    // than spending a retry attempt here. This call only applies the brand.
    const command = {
      eventId: EventId.parse(event.eventId),
      withdrawalId: WithdrawalId.parse(event.withdrawalId),
    };

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      try {
        await this.executeWithdrawal.execute(command);
        this.logger.log({
          eventId: event.eventId,
          withdrawalId: event.withdrawalId,
          userId: event.userId,
          operation: 'execute-withdrawal',
          result: 'processed',
          attempt,
        });
        return;
      } catch (error) {
        if (!isRetryable(error)) {
          await this.deadLetter(key, value, 'NON_RETRYABLE_FAILURE', error);
          return;
        }
        if (attempt === this.options.maxAttempts) {
          await this.deadLetter(key, value, 'RETRIES_EXHAUSTED', error);
          return;
        }
        this.logger.warn({
          eventId: event.eventId,
          withdrawalId: event.withdrawalId,
          operation: 'execute-withdrawal',
          result: 'retry-scheduled',
          attempt,
          errorCode: errorCode(error),
        });
        await this.options.sleep(this.options.backoffMs * attempt);
      }
    }
  }

  private parse(value: string): unknown {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }

  private async deadLetter(
    key: string | undefined,
    value: string,
    reason: DeadLetterReason,
    error: unknown,
  ): Promise<void> {
    const code = errorCode(error);
    this.logger.error({
      withdrawalId: key,
      operation: 'execute-withdrawal',
      result: 'dead-lettered',
      reason,
      errorCode: code,
    });
    await this.deadLetters.send({ key, value, reason, error: code });
  }
}
