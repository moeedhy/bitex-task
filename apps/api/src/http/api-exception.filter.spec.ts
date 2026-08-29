import { HttpException, HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { ApiExceptionFilter } from './api-exception.filter.js';
import type { ApiErrorBody } from './api-exception.filter.js';

const capture = () => {
  const sent: { status?: number; body?: ApiErrorBody } = {};
  const response = {
    headersSent: false,
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: ApiErrorBody) {
      sent.body = body;
    },
  };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ headers: { 'x-correlation-id': 'corr-1' } }),
    }),
  };
  return { sent, response, host };
};

const thrown = (exception: unknown) => {
  const { sent, host } = capture();
  new ApiExceptionFilter().catch(exception, host as never);
  return sent;
};

class Coded extends Error {
  constructor(readonly code: string, message = 'boom') {
    super(message);
    this.name = 'Coded';
  }
}

describe('ApiExceptionFilter', () => {
  it('maps a domain error code to its HTTP status', () => {
    expect(thrown(new Coded('IDEMPOTENCY_CONFLICT'))).toEqual({
      status: HttpStatus.CONFLICT,
      body: {
        statusCode: HttpStatus.CONFLICT,
        errorCode: 'IDEMPOTENCY_CONFLICT',
        message: 'boom',
      },
    });
  });

  it.each([
    ['RESERVATION_NOT_FOUND', HttpStatus.NOT_FOUND],
    ['INSUFFICIENT_RESERVED_BALANCE', HttpStatus.UNPROCESSABLE_ENTITY],
    ['INVALID_WITHDRAWAL_TRANSITION', HttpStatus.CONFLICT],
    ['INVALID_RESERVATION_TRANSITION', HttpStatus.CONFLICT],
    ['ASSET_MISMATCH', HttpStatus.BAD_REQUEST],
    ['INVALID_ASSET', HttpStatus.BAD_REQUEST],
  ])('no longer answers %s with a 500', (code, expected) => {
    expect(thrown(new Coded(code)).status).toBe(expected);
  });

  /**
   * The table these rely on is a `Record<ApiErrorCode, HttpStatus>`, so the
   * real guarantee -- that no library error can reach a client as an unmapped
   * 500 -- is enforced by `typecheck`, not by this list. These cases pin the
   * behaviour that the compiler cannot: which status each choice produces.
   */
  it('keeps genuine integrity alarms internal but names them', () => {
    expect(thrown(new Coded('STALE_WRITE'))).toEqual({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: 'STALE_WRITE',
        message: 'Internal server error.',
      },
    });
  });

  it('does not leak the message of an unmapped failure', () => {
    expect(thrown(new Error('connection string user=admin'))).toEqual({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: 'INTERNAL_ERROR',
        message: 'Internal server error.',
      },
    });
  });

  /**
   * `statusByCode` used to be an object literal, so this resolved through the
   * prototype to `Object.prototype.constructor` — a truthy function — and
   * `response.status(fn)` threw inside the filter itself.
   */
  it('is not confused by an error code that collides with Object.prototype', () => {
    expect(thrown(new Coded('constructor')).status).toBe(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(thrown(new Coded('toString')).status).toBe(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });

  describe('HttpException', () => {
    it('gives a string-bodied exception the same envelope as every other error', () => {
      // This is what `new HttpException('text', 400)` produces, and it used to
      // reach the client as a bare JSON string with no errorCode at all.
      expect(thrown(new HttpException('nope', HttpStatus.BAD_REQUEST))).toEqual({
        status: HttpStatus.BAD_REQUEST,
        body: {
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: 'INVALID_REQUEST',
          message: 'nope',
        },
      });
    });

    it('preserves an explicit errorCode from the thrower', () => {
      expect(
        thrown(
          new HttpException(
            { errorCode: 'RATE_LIMIT_EXCEEDED', message: 'slow down' },
            HttpStatus.TOO_MANY_REQUESTS,
          ),
        ).body,
      ).toEqual({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        errorCode: 'RATE_LIMIT_EXCEEDED',
        message: 'slow down',
      });
    });

    it('flattens the array message Nest pipes produce', () => {
      expect(
        thrown(
          new HttpException(
            { message: ['a is required', 'b is required'] },
            HttpStatus.BAD_REQUEST,
          ),
        ).body?.message,
      ).toBe('a is required; b is required');
    });
  });

  describe('ZodError', () => {
    it('names the offending field instead of only the constraint', () => {
      const schema = z.strictObject({ userId: z.string().min(1) });
      const result = schema.safeParse({ userId: '' });

      const body = thrown(result.error).body;

      expect(body?.statusCode).toBe(HttpStatus.BAD_REQUEST);
      expect(body?.errorCode).toBe('INVALID_REQUEST');
      expect(body?.message).toContain('userId');
    });
  });

  it('leaves an already-started response alone', () => {
    const { sent, response, host } = capture();
    response.headersSent = true;

    new ApiExceptionFilter().catch(new Coded('WALLET_NOT_FOUND'), host as never);

    expect(sent.status).toBeUndefined();
  });

  it('rethrows outside an HTTP context rather than guessing a response', () => {
    const host = { getType: () => 'rpc' };
    const error = new Coded('WALLET_NOT_FOUND');

    expect(() => new ApiExceptionFilter().catch(error, host as never)).toThrow(
      error,
    );
  });
});
