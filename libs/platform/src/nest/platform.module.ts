import { Global, Module } from '@nestjs/common';
import { CLOCK } from './platform.tokens.js';
import { provide } from './token.js';

/**
 * The system clock, as a provider rather than a module-scope constant.
 *
 * `const clock = { now: () => new Date() }` sat at the top of the composition
 * root and was closed over by three use-case factories. It bypassed DI
 * entirely, so nothing could substitute it — which is why every test that
 * needed a fixed time had to construct its use case by hand instead of asking
 * the container.
 *
 * Global because time is not a module's concern; `@Global` here means "one
 * clock", not "convenient".
 */
@Global()
@Module({
  providers: [provide(CLOCK, [], () => ({ now: () => new Date() }))],
  exports: [CLOCK],
})
export class PlatformModule {}
