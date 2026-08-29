import { Logger } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

/**
 * Redis is an optimisation here, never a source of truth, so connecting is
 * best-effort and non-blocking. The rate limiter fails open on top of that,
 * which keeps an outage from touching balances — or from delaying startup.
 */
export class RedisConnection implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisConnection.name);
  readonly client: RedisClientType;

  constructor(url: string) {
    this.client = createClient({ url }) as RedisClientType;
    // Registered here rather than in `onModuleInit`: the client exists from the
    // moment it is constructed, and an `'error'` event with no listener is an
    // unhandled error event, which terminates the process. That window — between
    // DI instantiating this provider and Nest calling the init hook — is small
    // but real, and losing the whole service to it would defeat the fail-open
    // design this class exists to provide.
    this.client.on('error', (error: Error) =>
      this.logger.warn({
        operation: 'redis',
        result: 'unavailable',
        errorCode: error.name,
      }),
    );
  }

  onModuleInit(): void {
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

  /**
   * Closes in the last shutdown hook, after the HTTP listener is gone, so a
   * request still being served can finish its rate-limit check.
   *
   * `close()` drains pending commands; the previous `disconnect()` is deprecated
   * in node-redis 6 in favour of `destroy()`, which rejects them immediately.
   */
  async onApplicationShutdown(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.close();
    }
  }
}
