# Engineering Decisions

## 1. Wallet is a separate bounded-context library

Wallet and Withdrawal have separate domains and Nx packages. Cross-context collaboration uses Withdrawal-owned capability ports and adapters at the composition root. They still share one PostgreSQL transaction today.

## 2. PostgreSQL row locking protects balances

Wallet mutation uses `SELECT ... FOR UPDATE`. In-memory or Redis locks cannot protect the source of truth across processes. Database checks provide defense in depth.

## 3. Durable idempotency with payload fingerprints

PostgreSQL owns `(operation, idempotency_key)`. Canonical request fingerprints distinguish legitimate replay from key reuse with different data. The claim occurs before Wallet locking.

## 4. Explicit TransactionRunner and AsyncLocalStorage

Application slices own transaction boundaries through a provider-neutral `TransactionRunner`. `AsyncLocalStorage` is confined to the PostgreSQL adapter and prevents transaction clients leaking into domain methods.

## 5. Modular monolith, not microservices or Saga

The required consistency fits a short local transaction. Splitting databases would add intermediate states, compensation, inbox/outbox coordination, and operational failure modes without helping this challenge.

## 6. Consumer-owned ports

Withdrawal defines separate reservation and settlement capabilities. It does not depend on Wallet repositories and no broad `WalletPort` or generic business service is introduced.

## 7. No generic repositories

Repositories expose aggregate-specific access paths such as `getForUpdate` and `getByReservationForUpdate`. Generic CRUD would hide locking and transaction requirements.

## 8. Provider idempotency

The fake provider persists one result per `withdrawalId`. Repeated calls return that result. Local database deduplication alone cannot make a non-idempotent external provider exactly once; production requires provider idempotency, lookup, or reconciliation.

## 9. Relational-first storage

This is transactional OLTP with strong integrity requirements. Core state is normalized into Wallet, Reservation, Withdrawal, Idempotency, Outbox, Processed Event, and fake-provider tables. JSONB is limited to immutable response/event envelopes, not query-critical business state.
