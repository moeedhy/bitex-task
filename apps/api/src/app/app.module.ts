import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { WithdrawalRuntime } from './withdrawal-runtime.js';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [WithdrawalRuntime],
})
export class AppModule {}
