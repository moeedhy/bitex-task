import {
  CanActivate,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { token } from '@bitex/platform/nest';

/**
 * Consumer-owned: the HTTP edge needs to know whether a caller may proceed. Redis
 * is one way to answer that, and this interface is what keeps the controller
 * from knowing which.
 */
export interface RateLimiter {
  allow(subject: string): Promise<boolean>;
}

export const RATE_LIMITER = token<RateLimiter>('RateLimiter');

/**
 * Rate limiting as a guard rather than a call inside the handler.
 *
 * It is a cross-cutting transport concern: it runs before the body is trusted,
 * it has one answer (429 or continue), and it has nothing to do with
 * withdrawals. Leaving it in the handler meant the controller injected the
 * concrete `RedisRateLimiter` and had to be edited to protect a second
 * endpoint.
 *
 * The subject is the `userId` from the body, which is why this reads the body
 * defensively: a malformed request has no subject to limit, and it is the
 * validation pipe's job — not this guard's — to reject it.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(@Inject(RATE_LIMITER) private readonly limiter: RateLimiter) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    const subject = (request.body as { userId?: unknown } | undefined)?.userId;
    if (typeof subject !== 'string' || subject.length === 0) {
      return true;
    }
    if (await this.limiter.allow(subject)) {
      return true;
    }
    throw new HttpException(
      {
        errorCode: 'RATE_LIMIT_EXCEEDED',
        message: 'Withdrawal rate limit exceeded.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
