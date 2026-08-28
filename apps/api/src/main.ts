import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app/app.module.js';
import { ApiExceptionFilter } from './app/api-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use((request: Request, response: Response, next: NextFunction) => {
    const correlationId = String(
      request.headers['x-correlation-id'] || randomUUID(),
    );
    request.headers['x-correlation-id'] = correlationId;
    response.setHeader('x-correlation-id', correlationId);
    next();
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  const port = process.env.PORT || 3000;
  await app.listen(port);
}

bootstrap();
