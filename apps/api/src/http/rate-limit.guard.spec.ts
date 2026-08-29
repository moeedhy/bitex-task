import { HttpException, HttpStatus } from '@nestjs/common';
import { UserId } from '@bitex/platform';
import { RateLimitGuard } from './rate-limit.guard.js';

const USER_ID = UserId.parse('22222222-2222-4222-8222-222222222222');

const contextFor = (body: unknown, type = 'http') =>
  ({
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => ({ body }) }),
  }) as never;

describe('RateLimitGuard', () => {
  it('lets a caller under the limit through', async () => {
    const guard = new RateLimitGuard({ allow: async () => true });

    await expect(guard.canActivate(contextFor({ userId: USER_ID }))).resolves.toBe(
      true,
    );
  });

  it('answers 429 with the shared error envelope', async () => {
    const guard = new RateLimitGuard({ allow: async () => false });

    await expect(
      guard.canActivate(contextFor({ userId: USER_ID })),
    ).rejects.toMatchObject({
      response: {
        errorCode: 'RATE_LIMIT_EXCEEDED',
        message: 'Withdrawal rate limit exceeded.',
      },
    });
  });

  it('reports the status the filter maps', async () => {
    const guard = new RateLimitGuard({ allow: async () => false });

    await guard.canActivate(contextFor({ userId: USER_ID })).catch((error) => {
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    });
  });

  it('limits by caller, not globally', async () => {
    const seen: string[] = [];
    const guard = new RateLimitGuard({
      allow: async (subject) => {
        seen.push(subject);
        return true;
      },
    });

    await guard.canActivate(contextFor({ userId: USER_ID }));

    expect(seen).toEqual([USER_ID]);
  });

  /**
   * A guard runs before validation, so it sees whatever was posted. A request
   * with no subject has nothing to limit; rejecting it here would answer 429 for
   * what is really a 400, and it is the schema's job to say so.
   */
  it.each([
    ['a body with no userId', {}],
    ['a non-string userId', { userId: 42 }],
    ['no body at all', undefined],
  ])('defers %s to validation instead of rate-limiting it', async (_l, body) => {
    const guard = new RateLimitGuard({
      allow: async () => {
        throw new Error('the limiter should not have been consulted');
      },
    });

    await expect(guard.canActivate(contextFor(body))).resolves.toBe(true);
  });

  it('ignores non-HTTP execution contexts', async () => {
    const guard = new RateLimitGuard({
      allow: async () => {
        throw new Error('the limiter should not have been consulted');
      },
    });

    await expect(
      guard.canActivate(contextFor({ userId: USER_ID }, 'rpc')),
    ).resolves.toBe(true);
  });
});
