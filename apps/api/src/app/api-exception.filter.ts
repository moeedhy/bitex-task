import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

const statusByCode: Record<string, number> = {
  IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT,
  IDEMPOTENCY_IN_PROGRESS: HttpStatus.CONFLICT,
  INSUFFICIENT_AVAILABLE_BALANCE: HttpStatus.UNPROCESSABLE_ENTITY,
  WITHDRAWAL_NOT_FOUND: HttpStatus.NOT_FOUND,
  INVALID_MONEY_AMOUNT: HttpStatus.BAD_REQUEST,
  MONEY_PRECISION_EXCEEDED: HttpStatus.BAD_REQUEST,
  UNSUPPORTED_ASSET: HttpStatus.BAD_REQUEST,
  INVALID_WITHDRAWAL: HttpStatus.BAD_REQUEST,
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    if (exception instanceof ZodError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: 'INVALID_REQUEST',
        message: exception.issues.map((issue) => issue.message).join('; '),
      });
      return;
    }
    const error = exception as Error & { code?: string };
    const status =
      (error.code && statusByCode[error.code]) ||
      HttpStatus.INTERNAL_SERVER_ERROR;
    response.status(status).json({
      statusCode: status,
      errorCode: error.code ?? 'INTERNAL_ERROR',
      message:
        status === HttpStatus.INTERNAL_SERVER_ERROR
          ? 'Internal server error.'
          : error.message,
    });
  }
}
