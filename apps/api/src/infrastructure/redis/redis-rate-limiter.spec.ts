import { RedisRateLimiter } from './redis-rate-limiter.js';

describe('RedisRateLimiter', () => {
  it('rejects requests above the configured window limit', async () => {
    const client = { incr: async () => 11, expire: async () => true };
    const limiter = new RedisRateLimiter(client as never, 10, 60);

    await expect(limiter.allow('user-123')).resolves.toBe(false);
  });

  it('fails open when Redis is unavailable', async () => {
    const client = {
      incr: async () => {
        throw new Error('redis unavailable');
      },
      expire: async () => true,
    };
    const limiter = new RedisRateLimiter(client as never, 10, 60);

    await expect(limiter.allow('user-123')).resolves.toBe(true);
  });
});
