import { Logger } from '@nestjs/common';
import type { Producer } from 'kafkajs';
import type {
  DeadLetterSink,
  DeadLetterReason,
} from './withdrawal-execution-consumer.js';

/**
 * Owns its own producer so the dead-letter path stays available independently
 * of the outbox publisher's lifecycle: the moment a message needs parking is
 * exactly the moment other machinery may be failing.
 */
export class KafkaDeadLetterSink implements DeadLetterSink {
  private readonly logger = new Logger(KafkaDeadLetterSink.name);

  constructor(
    private readonly producer: Producer,
    private readonly topic: string,
  ) {}

  async start(): Promise<void> {
    await this.producer.connect();
  }

  async stop(): Promise<void> {
    await this.producer.disconnect();
  }

  async send(record: {
    key: string | undefined;
    value: string;
    reason: DeadLetterReason;
    error: string;
  }): Promise<void> {
    try {
      await this.producer.send({
        topic: this.topic,
        messages: [
          {
            key: record.key ?? null,
            value: record.value,
            headers: {
              'dead-letter-reason': record.reason,
              'dead-letter-error': record.error,
              'dead-lettered-at': new Date().toISOString(),
            },
          },
        ],
      });
    } catch (error) {
      // Losing the parked copy must not resurrect the poison message: the
      // withdrawal itself is still recoverable from its PROCESSING state.
      this.logger.error({
        operation: 'dead-letter',
        result: 'unavailable',
        errorCode: (error as Error).name,
      });
    }
  }
}
