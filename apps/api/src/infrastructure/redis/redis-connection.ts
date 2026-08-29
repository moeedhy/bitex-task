import { Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

/**
 * Redis is an optimisation here, never a source of truth, so connecting is
 * best-effort and non-blocking. The rate limiter fails open on top of that,
 * which keeps an outage from touching balances — or from delaying startup.
 */
export class RedisConnection implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisConnection.name);
  readonly client: RedisClientType;

  constructor(url: string) {
    this.client = createClient({ url }) as RedisClientType;
  }

  onModuleInit(): void {
    this.client.on('error', (error: Error) =>
      this.logger.warn({
        operation: 'redis',
        result: 'unavailable',
        errorCode: error.name,
      }),
    );
    // Deliberately not awaited. The client retries indefinitely, so awaiting it
    // here would stop the service from ever listening when Redis is down —
    // turning an optimisation into a hard startup dependency and breaking the
    // fail-open guarantee at the one moment it matters most. Requests made
    // before the connection settles are simply not rate limited.
    void this.client.connect().catch((error: Error) =>
      this.logger.warn({
        operation: 'redis-connect',
        result: 'fail-open',
        errorCode: error.name,
      }),
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.disconnect();
    }
  }
}
