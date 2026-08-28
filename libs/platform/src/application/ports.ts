export interface TransactionRunner {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export interface IntegrationEvent<Payload = Record<string, unknown>> {
  id: string;
  type: string;
  aggregateId: string;
  occurredAt: Date;
  payload: Payload;
}

export interface Outbox {
  append(event: IntegrationEvent): Promise<void>;
}
