import { RedisRateLimiter } from './redis-rate-limiter.js';

describe('RedisRateLimiter', () => {
  const clientReturning = (count: number) => ({
    eval: jest.fn().mockResolvedValue(count),
  });

  it('allows a request inside the configured window limit', async () => {
    const limiter = new RedisRateLimiter(clientReturning(10) as never, 10, 60);

    await expect(limiter.allow('user-123')).resolves.toBe(true);
  });

  it('rejects requests above the configured window limit', async () => {
    const limiter = new RedisRateLimiter(clientReturning(11) as never, 10, 60);

    await expect(limiter.allow('user-123')).resolves.toBe(false);
  });

  it('counts and expires in one round trip so a crash cannot leak a key', async () => {
    const client = clientReturning(1);
    const limiter = new RedisRateLimiter(client as never, 10, 60, () => 0);

    await limiter.allow('user-123');

    expect(client.eval).toHaveBeenCalledTimes(1);
    expect(client.eval.mock.calls[0][1]).toEqual({
      keys: ['withdrawal-rate:user-123:0'],
      arguments: ['60'],
    });
  });

  it('moves to a new key when the window rolls over', async () => {
    const client = clientReturning(1);
    let now = 0;
    const limiter = new RedisRateLimiter(client as never, 10, 60, () => now);

    await limiter.allow('user-123');
    now = 60_000;
    await limiter.allow('user-123');

    expect(client.eval.mock.calls[0][1].keys).toEqual([
      'withdrawal-rate:user-123:0',
    ]);
    expect(client.eval.mock.calls[1][1].keys).toEqual([
      'withdrawal-rate:user-123:1',
    ]);
  });

  it('fails open when Redis is unavailable', async () => {
    const client = {
      eval: jest.fn().mockRejectedValue(new Error('redis unavailable')),
    };
    const limiter = new RedisRateLimiter(client as never, 10, 60);

    await expect(limiter.allow('user-123')).resolves.toBe(true);
  });
});
