import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Carries the correlation id from the HTTP edge to wherever the work ends up,
 * without threading a parameter through every port signature.
 *
 * The id was previously generated in `main.ts` and died at the controller —
 * which is exactly the half of the flow that does not need it. What needed it
 * was the outbox row, the Kafka header and the consumer log: the asynchronous
 * half, where correlating a customer's complaint with a settlement is otherwise
 * a matter of matching timestamps by eye.
 *
 * `AsyncLocalStorage` rather than a request-scoped provider because the
 * asynchronous half has no request: the outbox publisher and the Kafka consumer
 * run on timers and broker callbacks, and a request-scoped Nest provider cannot
 * reach either.
 */
export function runWithRequestContext<T>(
  context: RequestContext,
  operation: () => T,
): T {
  return storage.run(context, operation);
}

export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
