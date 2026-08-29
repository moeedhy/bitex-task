import { Module } from '@nestjs/common';
import { RedisConnection } from '../infrastructure/redis/redis-connection.js';
import { RedisRateLimiter } from '../infrastructure/redis/redis-rate-limiter.js';
import { envNumber, envString } from './env.js';

@Module({
  providers: [
    {
      provide: RedisConnection,
      useFactory: () =>
        new RedisConnection(
          envString(process.env.REDIS_URL, 'redis://localhost:6379'),
        ),
    },
    {
      provide: RedisRateLimiter,
      inject: [RedisConnection],
      useFactory: (redis: RedisConnection) =>
        new RedisRateLimiter(
          redis.client,
          envNumber(process.env.WITHDRAWAL_RATE_LIMIT, 10),
          envNumber(process.env.WITHDRAWAL_RATE_LIMIT_WINDOW_SECONDS, 60),
        ),
    },
  ],
  exports: [RedisRateLimiter],
})
export class RedisModule {}
