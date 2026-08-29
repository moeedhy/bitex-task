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
  UseGuards,
} from '@nestjs/common';
import { Money, resolveAsset, UserId, WithdrawalId } from '@bitex/platform';
import type { GetWithdrawal, RequestWithdrawal } from '@bitex/withdrawal';
import { GET_WITHDRAWAL, REQUEST_WITHDRAWAL } from '@bitex/withdrawal/nest';
import { currentCorrelationId } from '../observability/request-context.js';
import {
  CreateWithdrawalSchema,
  toCreateWithdrawalResponse,
  toWithdrawalResponse,
} from './dto/withdrawal.dto.js';
import type {
  CreateWithdrawalResponse,
  WithdrawalResponse,
} from './dto/withdrawal.dto.js';
import { RateLimitGuard } from './rate-limit.guard.js';

/**
 * Transport concerns only: shape, the required header, and turning raw strings
 * into semantic values.
 *
 * Amount validity, idempotency semantics and request fingerprinting all belong
 * to the workflow, so this class holds no business rule and reaches no
 * repository — it depends on two use cases and nothing else. Rate limiting moved
 * to a guard, which is why the concrete Redis limiter is no longer injected here.
 */
@Injectable()
@Controller('withdrawals')
export class WithdrawalsController {
  private readonly logger = new Logger(WithdrawalsController.name);

  constructor(
    @Inject(REQUEST_WITHDRAWAL)
    private readonly requestWithdrawal: RequestWithdrawal,
    @Inject(GET_WITHDRAWAL) private readonly getWithdrawal: GetWithdrawal,
  ) {}

  @Post()
  @UseGuards(RateLimitGuard)
  async createWithdrawal(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() rawBody: unknown,
  ): Promise<CreateWithdrawalResponse> {
    if (!idempotencyKey?.trim()) {
      throw new HttpException(
        {
          errorCode: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'Idempotency-Key header is required.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const body = CreateWithdrawalSchema.parse(rawBody);
    const userId = UserId.parse(body.userId);
    const result = await this.requestWithdrawal.execute({
      idempotencyKey: idempotencyKey.trim(),
      userId,
      amount: Money.parse(body.amount, resolveAsset(body.asset)),
      destinationAddress: body.destinationAddress,
    });

    this.logger.log({
      correlationId: currentCorrelationId(),
      withdrawalId: result.withdrawalId,
      userId,
      operation: 'request-withdrawal',
      result: result.status,
    });
    return toCreateWithdrawalResponse(result);
  }

  /**
   * `WithdrawalId.parse` is what keeps a malformed path parameter a 400 rather
   * than a 500. Once the ids are `uuid` columns, handing PostgreSQL
   * `not-a-uuid` raises `22P02` from inside the query — an unmapped driver
   * error — instead of returning zero rows and a clean 404.
   */
  @Get(':withdrawalId')
  async getById(
    @Param('withdrawalId') withdrawalId: string,
  ): Promise<WithdrawalResponse> {
    const view = await this.getWithdrawal.execute(
      WithdrawalId.parse(withdrawalId),
    );
    return toWithdrawalResponse(view);
  }
}
