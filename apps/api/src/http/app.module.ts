import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { PlatformModule } from '@bitex/platform/nest';
import { ConfigModule } from '../config/config.module.js';
import { MessagingModule } from '../modules/messaging.module.js';
import { RedisModule } from '../modules/redis.module.js';
import { WithdrawalContextModule } from '../modules/withdrawal-context.module.js';
import { CorrelationIdMiddleware } from '../observability/correlation-id.middleware.js';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { WithdrawalsController } from './withdrawals.controller.js';

/**
 * The application is now wiring only: it chooses the adapters and hands them to
 * the contexts, which wire their own use cases.
 *
 * What used to live here — `apps/api/src/composition/`, five files and ~490
 * lines of `useFactory` boilerplate correlating positional `inject` arrays with
 * positional factory parameters by hand — is gone. The contexts own their
 * composition because they own their boundaries.
 */
@Module({
  imports: [
    ConfigModule,
    PlatformModule,
    WithdrawalContextModule,
    RedisModule,
    MessagingModule,
  ],
  controllers: [WithdrawalsController],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    RateLimitGuard,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Registered as Nest middleware rather than `app.use` in `main.ts`, so the
    // async context it opens actually encloses the handler. An `app.use`
    // callback that calls `next()` outside the store leaves every downstream
    // `getStore()` empty.
    consumer.apply(CorrelationIdMiddleware).forRoutes('*path');
  }
}
