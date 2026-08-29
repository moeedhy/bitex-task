import { Module } from '@nestjs/common';
import { provide, token } from '@bitex/platform/nest';
import { RATE_LIMITER } from '../http/rate-limit.guard.js';
import { RedisConnection } from '../adapters/redis/redis-connection.js';
import { RedisRateLimiter } from '../adapters/redis/redis-rate-limiter.js';
import { APP_CONFIG } from '../config/config.module.js';

const REDIS = token<RedisConnection>('RedisConnection');

@Module({
  providers: [
    provide(REDIS, [APP_CONFIG], (config) => new RedisConnection(config.REDIS_URL)),
    provide(
      RATE_LIMITER,
      [REDIS, APP_CONFIG],
      (redis, config) =>
        new RedisRateLimiter(
          redis.client,
          config.WITHDRAWAL_RATE_LIMIT,
          config.WITHDRAWAL_RATE_LIMIT_WINDOW_SECONDS,
        ),
    ),
  ],
  exports: [RATE_LIMITER],
})
export class RedisModule {}
