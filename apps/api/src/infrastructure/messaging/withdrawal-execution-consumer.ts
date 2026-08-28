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
  destinationAddress: z.string().min(1),
  occurredAt: z.string().datetime(),
});

export class WithdrawalExecutionConsumer {
  private readonly logger = new Logger(WithdrawalExecutionConsumer.name);
  constructor(
    private readonly consumer: Consumer,
    private readonly topic: string,
    private readonly executeWithdrawal: ExecuteWithdrawal,
  ) {}

  async start(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: this.topic, fromBeginning: false });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        const event = EventSchema.parse(
          JSON.parse(message.value?.toString('utf8') ?? '{}'),
        );
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
        });
      },
    });
  }

  async stop(): Promise<void> {
    await this.consumer.disconnect();
  }
}
