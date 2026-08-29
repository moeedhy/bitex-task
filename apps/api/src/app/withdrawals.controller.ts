import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { Money, resolveAsset, UserId, WithdrawalId } from '@bitex/platform';
import type { GetWithdrawal, RequestWithdrawal } from '@bitex/withdrawal';
import { GET_WITHDRAWAL, REQUEST_WITHDRAWAL } from '@bitex/withdrawal/nest';
import { z } from 'zod';
import type { RedisRateLimiter } from '../adapters/redis/redis-rate-limiter.js';
import { RATE_LIMITER } from '../modules/redis.module.js';

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
    @Inject(REQUEST_WITHDRAWAL)
    private readonly requestWithdrawal: RequestWithdrawal,
    @Inject(GET_WITHDRAWAL) private readonly getWithdrawal: GetWithdrawal,
    @Inject(RATE_LIMITER) private readonly rateLimiter: RedisRateLimiter,
  ) {}

  @Post()
  async createWithdrawal(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() rawBody: unknown,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new HttpException(
        {
          errorCode: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'Idempotency-Key header is required.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const body = RequestSchema.parse(rawBody);
    const userId = UserId.parse(body.userId);
    const amount = Money.parse(body.amount, resolveAsset(body.asset));
    if (!(await this.rateLimiter.allow(userId))) {
      throw new HttpException(
        {
          errorCode: 'RATE_LIMIT_EXCEEDED',
          message: 'Withdrawal rate limit exceeded.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const result = await this.requestWithdrawal.execute({
      idempotencyKey: idempotencyKey.trim(),
      userId,
      amount,
      destinationAddress: body.destinationAddress,
    });
    this.logger.log({
      correlationId,
      withdrawalId: result.withdrawalId,
      userId,
      operation: 'request-withdrawal',
      result: result.status,
    });
    return result;
  }

  /**
   * `WithdrawalId.parse` is what keeps a malformed path parameter a 400 rather
   * than a 500. Once the ids are `uuid` columns, handing PostgreSQL
   * `not-a-uuid` raises `22P02` from inside the query — an unmapped driver
   * error — instead of returning zero rows and a clean 404.
   */
  @Get(':withdrawalId')
  getById(@Param('withdrawalId') withdrawalId: string) {
    return this.getWithdrawal.execute(WithdrawalId.parse(withdrawalId));
  }
}
