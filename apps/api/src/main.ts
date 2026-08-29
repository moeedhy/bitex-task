import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { errorCode, errorMessage } from '@bitex/platform';
import { AppModule } from './http/app.module.js';
import { APP_CONFIG } from './config/config.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Shutdown hooks drive the messaging lifecycle, so consumers and publishers
  // stop cleanly instead of being killed mid-batch.
  app.enableShutdownHooks();
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
