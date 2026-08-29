import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { PlatformModule } from '@bitex/platform/nest';
import { ConfigModule } from '../config/config.module.js';
import { MessagingModule } from '../modules/messaging.module.js';
import { RedisModule } from '../modules/redis.module.js';
import { WithdrawalContextModule } from '../modules/withdrawal-context.module.js';
import { ApiExceptionFilter } from './api-exception.filter.js';
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
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}
