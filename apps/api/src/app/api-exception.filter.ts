import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import {
  errorCode as codeOf,
  errorMessage,
} from '../infrastructure/shared/error-context.js';

export interface ApiErrorBody {
  statusCode: number;
  errorCode: string;
  message: string;
}

/**
 * Domain and application failures that have a meaningful HTTP answer.
 *
 * A `Map` rather than an object literal on purpose: an object literal is looked
 * up through its prototype, so an error carrying `code: 'constructor'` resolved
 * to `Object.prototype.constructor` — a truthy function — and `response.status(fn)`
 * then threw *inside the exception filter*, escaping to Express' default handler.
 */
const statusByCode = new Map<string, HttpStatus>([
  ['IDEMPOTENCY_CONFLICT', HttpStatus.CONFLICT],
  ['INSUFFICIENT_AVAILABLE_BALANCE', HttpStatus.UNPROCESSABLE_ENTITY],
  ['INSUFFICIENT_RESERVED_BALANCE', HttpStatus.UNPROCESSABLE_ENTITY],
  ['WITHDRAWAL_NOT_FOUND', HttpStatus.NOT_FOUND],
  ['WALLET_NOT_FOUND', HttpStatus.NOT_FOUND],
  ['RESERVATION_NOT_FOUND', HttpStatus.NOT_FOUND],
  ['INVALID_MONEY_AMOUNT', HttpStatus.BAD_REQUEST],
  ['MONEY_PRECISION_EXCEEDED', HttpStatus.BAD_REQUEST],
  ['UNSUPPORTED_ASSET', HttpStatus.BAD_REQUEST],
  ['INVALID_ASSET', HttpStatus.BAD_REQUEST],
  ['ASSET_MISMATCH', HttpStatus.BAD_REQUEST],
  ['INVALID_WITHDRAWAL', HttpStatus.BAD_REQUEST],
  ['INVALID_WITHDRAWAL_ADDRESS', HttpStatus.BAD_REQUEST],
  ['INVALID_WALLET_AMOUNT', HttpStatus.BAD_REQUEST],
  ['INVALID_RESERVATION_AMOUNT', HttpStatus.BAD_REQUEST],
  ['WALLET_ASSET_MISMATCH', HttpStatus.UNPROCESSABLE_ENTITY],
  ['INVALID_WITHDRAWAL_TRANSITION', HttpStatus.CONFLICT],
  ['INVALID_RESERVATION_TRANSITION', HttpStatus.CONFLICT],
]);

/**
 * Codes that are 500 *on purpose*, listed so that "deliberately internal" is
 * distinguishable from "nobody mapped it yet". Each one means the service's own
 * state or wiring is wrong, not the caller's request.
 */
const deliberatelyInternal = new Set([
  'INVALID_WALLET_STATE',
  'WITHDRAWAL_EXECUTION_UNRESOLVED',
  'MISSING_TRANSACTION',
  'CORRUPT_IDEMPOTENCY_RECORD',
  'STALE_WRITE',
]);

const codeByStatus = new Map<number, string>([
  [HttpStatus.BAD_REQUEST, 'INVALID_REQUEST'],
  [HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED'],
  [HttpStatus.FORBIDDEN, 'FORBIDDEN'],
  [HttpStatus.NOT_FOUND, 'NOT_FOUND'],
  [HttpStatus.CONFLICT, 'CONFLICT'],
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'UNSUPPORTED_MEDIA_TYPE'],
  [HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMIT_EXCEEDED'],
]);

/**
 * One error envelope for every failure the API can produce.
 *
 * Previously this filter emitted three different shapes: domain errors got
 * `{statusCode, errorCode, message}`, Zod errors got the same, and anything
 * thrown as `new HttpException('text', status)` was passed straight through as
 * a bare JSON *string* — which is what the two most common client errors, the
 * missing `Idempotency-Key` 400 and the rate-limit 429, actually returned. A
 * client parsing `errorCode` broke on exactly those two.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    // A globally registered filter sees every execution context, not just HTTP.
    if (host.getType() !== 'http') {
      throw exception;
    }

    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const correlationId = http.getRequest<{
      headers?: Record<string, unknown>;
    }>()?.headers?.['x-correlation-id'];

    const body = this.toBody(exception);

    const log = {
      correlationId,
      operation: 'http-request',
      result: 'failed',
      statusCode: body.statusCode,
      errorCode: body.errorCode,
    };
    // Server faults carry the underlying message; client faults do not need it.
    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error({ ...log, message: errorMessage(exception) });
    } else {
      this.logger.warn(log);
    }

    // Streaming or partially-written responses cannot be given a status.
    if (response.headersSent) {
      return;
    }
    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ApiErrorBody {
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }
    if (exception instanceof ZodError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: 'INVALID_REQUEST',
        // The path is the useful half: without it a client is told only
        // "expected string to have >=1 characters" and cannot tell which field
        // it was.
        message: exception.issues
          .map((issue) =>
            issue.path.length > 0
              ? `${issue.path.join('.')}: ${issue.message}`
              : issue.message,
          )
          .join('; '),
      };
    }

    const code = codeOf(exception);
    const status = statusByCode.get(code) ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const internal = status === HttpStatus.INTERNAL_SERVER_ERROR;
    return {
      statusCode: status,
      errorCode: internal && !deliberatelyInternal.has(code)
        ? 'INTERNAL_ERROR'
        : code,
      message: internal ? 'Internal server error.' : errorMessage(exception),
    };
  }

  private fromHttpException(exception: HttpException): ApiErrorBody {
    const statusCode = exception.getStatus();
    const payload = exception.getResponse();
    const fallbackCode =
      codeByStatus.get(statusCode) ??
      (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR
        ? 'INTERNAL_ERROR'
        : 'HTTP_ERROR');

    if (typeof payload === 'string') {
      return { statusCode, errorCode: fallbackCode, message: payload };
    }

    const record = payload as Record<string, unknown>;
    const message = record['message'];
    return {
      statusCode,
      errorCode:
        typeof record['errorCode'] === 'string'
          ? record['errorCode']
          : fallbackCode,
      message: Array.isArray(message)
        ? message.join('; ')
        : typeof message === 'string'
          ? message
          : exception.message,
    };
  }
}
