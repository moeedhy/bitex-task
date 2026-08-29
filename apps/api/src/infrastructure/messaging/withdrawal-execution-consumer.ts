import type { ExecuteWithdrawal } from '@bitex/withdrawal';
import { Logger } from '@nestjs/common';
import type { Consumer } from 'kafkajs';
import { z } from 'zod';

const EventSchema = z.strictObject({
  eventId: z.string().min(1),
  eventType: z.literal('WithdrawalExecutionRequested'),
  withdrawalId: z.string().min(1),
  userId: z.string().min(1),
  asset: z.string().min(1),
  amount: z.string().min(1),
  occurredAt: z.string().datetime(),
});

/**
 * Failures that cannot become successes by trying again: the referenced state
 * is missing or the transition is not legal. Retrying these forever would park
 * the partition without ever making progress.
 */
const NON_RETRYABLE_CODES = new Set([
  'WITHDRAWAL_NOT_FOUND',
  'INVALID_WITHDRAWAL',
  'INVALID_WITHDRAWAL_ADDRESS',
  'INVALID_WITHDRAWAL_TRANSITION',
  'RESERVATION_NOT_FOUND',
  'INVALID_RESERVATION_TRANSITION',
  'WALLET_NOT_FOUND',
  'WALLET_ASSET_MISMATCH',
]);

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
    const parsed = EventSchema.safeParse(this.parse(value));
    if (!parsed.success) {
      await this.deadLetter(key, value, 'UNPARSEABLE_MESSAGE', parsed.error);
      return;
    }
    const event = parsed.data;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      try {
        await this.executeWithdrawal.execute({
          eventId: event.eventId,
          withdrawalId: event.withdrawalId,
        });
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

function errorCode(error: unknown): string {
  const candidate = error as { code?: unknown; name?: unknown };
  if (typeof candidate?.code === 'string') {
    return candidate.code;
  }
  return typeof candidate?.name === 'string' ? candidate.name : 'UNKNOWN_ERROR';
}

function isRetryable(error: unknown): boolean {
  return !NON_RETRYABLE_CODES.has(errorCode(error));
}
