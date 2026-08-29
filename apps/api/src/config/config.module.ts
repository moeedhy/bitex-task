import { Global, Module } from '@nestjs/common';
import { provide, token } from '@bitex/platform/nest';
import { loadAppConfig } from './app-config.js';
import type { AppConfig } from './app-config.js';

export const APP_CONFIG = token<AppConfig>('AppConfig');

/**
 * Global because configuration is not a module's concern, and because the
 * alternative is threading one import through every module that reads a single
 * value.
 */
@Global()
@Module({
  providers: [provide(APP_CONFIG, [], () => loadAppConfig())],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
