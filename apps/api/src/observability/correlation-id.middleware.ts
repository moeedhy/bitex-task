import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithRequestContext } from './request-context.js';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Accepts the caller's correlation id or mints one, echoes it back, and opens
 * the async context that the rest of the request runs inside.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const supplied = request.headers[CORRELATION_ID_HEADER];
    const correlationId =
      (Array.isArray(supplied) ? supplied[0] : supplied)?.trim() ||
      randomUUID();

    request.headers[CORRELATION_ID_HEADER] = correlationId;
    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    runWithRequestContext({ correlationId }, next);
  }
}
