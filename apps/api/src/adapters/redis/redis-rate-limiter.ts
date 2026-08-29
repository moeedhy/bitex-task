import type { RedisClientType } from 'redis';

const WINDOW_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`;

/**
 * Fixed-window request counter.
 *
 * The increment and the expiry are one script so a crash between them cannot
 * leave a key without a TTL. Every failure path returns `true`: Redis protects
 * the endpoint from abuse, never the balance, so an outage must degrade
 * throttling rather than block withdrawals.
 */
export class RedisRateLimiter {
  constructor(
    private readonly client: Pick<RedisClientType, 'eval'>,
    private readonly limit = 10,
    private readonly windowSeconds = 60,
    private readonly now: () => number = Date.now,
  ) {}

  async allow(userId: string): Promise<boolean> {
    const bucket = Math.floor(this.now() / 1000 / this.windowSeconds);
    const key = `withdrawal-rate:${userId}:${bucket}`;
    try {
      const count = await this.client.eval(WINDOW_SCRIPT, {
        keys: [key],
        arguments: [String(this.windowSeconds)],
      });
      return typeof count === 'number' ? count <= this.limit : true;
    } catch {
      return true;
    }
  }
}
