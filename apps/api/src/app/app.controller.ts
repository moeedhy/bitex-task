import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Money, resolveAsset } from '@bitex/platform';
import { z } from 'zod';
import { WithdrawalRuntime } from './withdrawal-runtime.js';

const RequestSchema = z.strictObject({
  userId: z.string().trim().min(1).max(128),
  asset: z.string().trim().min(1).max(32),
  amount: z.string().trim().min(1).max(128),
  destinationAddress: z.string().trim().min(1).max(256),
});

@Controller('withdrawals')
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(private readonly runtime: WithdrawalRuntime) {}

  @Post()
  async createWithdrawal(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() rawBody: unknown,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new HttpException(
        'Idempotency-Key header is required.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const body = RequestSchema.parse(rawBody);
    const asset = resolveAsset(body.asset);
    const amount = Money.parse(body.amount, asset);
    if (!amount.isPositive()) {
      throw new HttpException(
        'Amount must be greater than zero.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!(await this.runtime.rateLimiter.allow(body.userId))) {
      throw new HttpException(
        'Withdrawal rate limit exceeded.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          userId: body.userId,
          asset: asset.code,
          amount: amount.toDecimalString(),
          destinationAddress: body.destinationAddress,
        }),
      )
      .digest('hex');
    const result = await this.runtime.requestWithdrawal.execute({
      idempotencyKey: idempotencyKey.trim(),
      fingerprint,
      userId: body.userId,
      asset,
      amount,
      destinationAddress: body.destinationAddress,
    });
    this.logger.log({
      correlationId,
      withdrawalId: result.withdrawalId,
      userId: body.userId,
      operation: 'request-withdrawal',
      result: result.status,
    });
    return result;
  }

  @Get(':withdrawalId')
  getWithdrawal(@Param('withdrawalId') withdrawalId: string) {
    return this.runtime.getWithdrawal.execute(withdrawalId);
  }
}
