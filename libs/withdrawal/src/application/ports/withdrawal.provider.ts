import { z } from 'zod';

export const ExecutionResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('SUCCESS'),
    transactionReference: z.string().trim().min(1).max(256),
  }),
  z.strictObject({
    status: z.literal('FAILED'),
    reason: z.literal('PROVIDER_ERROR'),
  }),
]);

export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

export const ExecutionRequestSchema = z.strictObject({
  withdrawalId: z.string().trim().min(1).max(256),
  amount: z.string().trim().min(1).max(256),
  asset: z.string().trim().min(1).max(256),
  destinationAddress: z.string().trim().min(1).max(256),
});

export type ExecutionRequest = z.infer<typeof ExecutionRequestSchema>;

export abstract class WithdrawalProvider {
  abstract execute(request: ExecutionRequest): Promise<ExecutionResult>;
}
