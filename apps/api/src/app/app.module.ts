import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { MessagingModule } from '../composition/messaging.module.js';
import { RedisModule } from '../composition/redis.module.js';
import { WithdrawalModule } from '../composition/withdrawal.module.js';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { WithdrawalsController } from './withdrawals.controller.js';

@Module({
  imports: [WithdrawalModule, RedisModule, MessagingModule],
  controllers: [WithdrawalsController],
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}
