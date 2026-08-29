import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { Money, resolveAsset } from '@bitex/platform';
import { GetWithdrawal, RequestWithdrawal } from '@bitex/withdrawal';
import { z } from 'zod';
import { RedisRateLimiter } from '../infrastructure/redis/redis-rate-limiter.js';

const RequestSchema = z.strictObject({
  userId: z.string().trim().min(1).max(128),
  asset: z.string().trim().min(1).max(32),
  amount: z.string().trim().min(1).max(128),
  destinationAddress: z.string().trim().min(1).max(256),
});

/**
 * Transport concerns only: shape, the required header, the rate limit, and
 * turning raw strings into semantic values.
 *
 * Amount validity, idempotency semantics and request fingerprinting all belong
 * to the workflow, so this class holds no business rule and reaches no
 * repository — it depends on two use cases and nothing else.
 */
@Injectable()
@Controller('withdrawals')
export class WithdrawalsController {
  private readonly logger = new Logger(WithdrawalsController.name);

  constructor(
    private readonly requestWithdrawal: RequestWithdrawal,
    private readonly getWithdrawal: GetWithdrawal,
    private readonly rateLimiter: RedisRateLimiter,
  ) {}

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
    const amount = Money.parse(body.amount, resolveAsset(body.asset));
    if (!(await this.rateLimiter.allow(body.userId))) {
      throw new HttpException(
        'Withdrawal rate limit exceeded.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const result = await this.requestWithdrawal.execute({
      idempotencyKey: idempotencyKey.trim(),
      userId: body.userId,
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
  getById(@Param('withdrawalId') withdrawalId: string) {
    return this.getWithdrawal.execute(withdrawalId);
  }
}
