import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app/app.module.js';

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
  const port = process.env.PORT || 3000;
  await app.listen(port);
}

bootstrap().catch((error) => {
  new Logger('Bootstrap').error({
    operation: 'bootstrap',
    result: 'failed',
    errorCode: (error as Error).name,
    message: (error as Error).message,
  });
  process.exitCode = 1;
});
