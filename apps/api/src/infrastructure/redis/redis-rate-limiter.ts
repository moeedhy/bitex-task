import type { RedisClientType } from 'redis';

export class RedisRateLimiter {
  constructor(
    private readonly client: Pick<RedisClientType, 'incr' | 'expire'>,
    private readonly limit = 10,
    private readonly windowSeconds = 60,
    private readonly now: () => number = Date.now,
  ) {}

  async allow(userId: string): Promise<boolean> {
    const bucket = Math.floor(this.now() / 1000 / this.windowSeconds);
    const key = `withdrawal-rate:${userId}:${bucket}`;
    try {
      const count = await this.client.incr(key);
      if (count === 1) {
        await this.client.expire(key, this.windowSeconds);
      }
      return count <= this.limit;
    } catch {
      return true;
    }
  }
}
