import type { AnyIntegrationEvent } from '../events/integration-event.js';

export interface TransactionRunner {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}

export interface Outbox {
  append(event: AnyIntegrationEvent): Promise<void>;
}
