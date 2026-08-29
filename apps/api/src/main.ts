import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { errorCode, errorMessage } from '@bitex/platform';
import { AppModule } from './app/app.module.js';
import { APP_CONFIG } from './config/config.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Shutdown hooks drive the messaging lifecycle, so consumers and publishers
  // stop cleanly instead of being killed mid-batch.
  app.enableShutdownHooks();
  app.use((request: Request, response: Response, next: NextFunction) => {
    const correlationId = String(
      request.headers['x-correlation-id'] || randomUUID(),
    );
    request.headers['x-correlation-id'] = correlationId;
    response.setHeader('x-correlation-id', correlationId);
    next();
  });
  const config = app.get(APP_CONFIG);
  await app.listen(config.PORT);
}

bootstrap().catch((error) => {
  new Logger('Bootstrap').error({
    operation: 'bootstrap',
    result: 'failed',
    errorCode: errorCode(error),
    message: errorMessage(error),
  });
  process.exitCode = 1;
});
