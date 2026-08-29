# Engineering Decisions

## 1. Wallet is a separate domain library

Wallet and Withdrawal have separate domain ownership and Nx packages. Cross-boundary collaboration uses Withdrawal-owned capability ports and adapters at the composition root. They still share one PostgreSQL transaction today.

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

## 7. Separate aggregate repositories

`WalletAccount` does not contain reservation history. `WalletRepository` and `WalletReservationRepository` expose separate lock and persistence paths for their aggregate roots. Generic CRUD would hide those locking and transaction requirements.

## 8. Provider idempotency

The fake provider persists one result per `withdrawalId`. Repeated calls return that result. Local database deduplication alone cannot make a non-idempotent external provider exactly once; production requires provider idempotency, lookup, or reconciliation.

## 9. Relational-first storage

This is transactional OLTP with strong integrity requirements. Core state is normalized into Wallet, Reservation, Withdrawal, Idempotency, Outbox, Processed Event, and fake-provider tables. JSONB is limited to immutable response/event envelopes, not query-critical business state.

## 10. Additive aggregate-boundary migration

Migration `002_domain_aggregate_refactor.sql` backfills the reservation asset before making it required, replaces the old foreign keys with Wallet/asset and reservation/Withdrawal ownership constraints, and translates `FUNDS_RESERVED` to `PENDING`. The committed initial migration remains unchanged so existing and fresh databases follow the same history.

## 11. `Money` is signed; aggregates own non-negativity

`Money` models a signed exact quantity: `subtract` may return a negative result and `parse` accepts a leading `-`. The domain plan suggests a non-negative amount type instead, so this is a deliberate divergence.

A signed type lets `availableBalance` be a plain `balance - reserved` with no special case, and keeps `Money` a pure arithmetic value object rather than one carrying a wallet-specific rule. Non-negativity is enforced where it is actually a business rule, at three layers: the HTTP edge rejects non-positive request amounts, `WalletAccount.assertOperationAmount` rejects non-positive operands, and `WalletAccount.assertBalances` rejects negative balances on creation, reconstitution, and every mutation. Database `CHECK` constraints repeat the last of these.

## 12. Unresolved provider execution never auto-fails a Withdrawal

`Withdrawal.fail` accepts only `PROVIDER_ERROR` from `PROCESSING` — a provider that answered and rejected. When the provider call *throws* instead, the outcome is unknown: the transfer may already have happened.

`ExecuteWithdrawal` therefore wraps that throw in `WithdrawalExecutionUnresolvedError` and leaves the Withdrawal `PROCESSING` and the reservation `ACTIVE`. Kafka redelivery re-drives the idempotent provider, which is safe; releasing the reservation on an ambiguous timeout would not be, because it frees funds that may already be gone.

The residual gap is a Withdrawal stranded in `PROCESSING` once redelivery is exhausted. That needs a reconciliation sweep over stale `PROCESSING` rows plus a provider status lookup, which is follow-up work rather than something the aggregates can decide.

## 13. Idempotency outcomes are return values, not adapter exceptions

`WithdrawalIdempotencyPort.claim` returns `CLAIMED | REPLAY | CONFLICT` and the use case handles it exhaustively. If the adapter threw its own error type instead, whichever storage detected the collision would define the API's 409 behaviour and swapping it would silently change the contract. The conflict path is also unit-testable without a database.

Because claim and completion share one transaction, an abandoned claim rolls back: a request rejected on a business rule leaves the key reusable, and a committed record is always `COMPLETED`. A committed record that is not is treated as a data-integrity alarm rather than a business outcome.

## 14. Request fingerprinting is application policy

The fingerprint is computed inside `RequestWithdrawal` from parsed values, not supplied by the caller. Any second driving adapter then stays compatible by construction, and normalising the destination through `WithdrawalAddress` before fingerprinting prevents a future normalisation change from turning one retry into two withdrawals. Fields are length-prefixed so caller-supplied content cannot forge a field boundary.

## 15. Poison messages are dead-lettered, not retried forever

Rethrowing from `eachMessage` parks a Kafka partition on one bad record and strands every other withdrawal behind it. Unparseable and non-retryable failures go straight to `<topic>.dlq`; everything else is retried with backoff and then dead-lettered. Availability of the pipeline is preferred over infinite retry of a message that cannot succeed.

## 16. Stranded withdrawals are recovered by re-publishing intent

At-least-once delivery only recovers crashes while the message still exists. `RecoverStuckWithdrawals` re-publishes execution intent for withdrawals left `PROCESSING` past a timeout, using a fresh event id so consumer deduplication cannot suppress the retry. Safety comes from the terminal-state check and provider idempotency rather than from deduplication. A withdrawal that can never resolve is retried indefinitely; bounding that needs an attempt counter, and stalling a financial operation silently is worse.

## 17. Bounded lock waits

Transactions set `lock_timeout` and `statement_timeout` locally. Duplicate requests on one key serialise on the idempotency row while holding a pooled connection, and the pool is shared with the outbox publisher and recovery worker, so failing a contended request is preferable to starving event delivery.

## 18. Module boundaries are enforced, not documented

Projects carry `type:` and `scope:` tags and `@nx/enforce-module-boundaries` encodes the dependency rules. A withdrawal-to-wallet import fails `lint`, which turns the architecture's central constraint from a review comment into a build error.

## 19. Nest modules mirror the bounded contexts

Composition lives in `WalletModule`, `WithdrawalModule`, `PersistenceModule`, `RedisModule` and `MessagingModule` rather than in one runtime object that the controller reads through. The controller now receives `RequestWithdrawal` and `GetWithdrawal` by constructor injection and can reach nothing else.

Providers are registered with `useFactory` against class tokens. Ports stay plain TypeScript interfaces resolved inside the factories, which keeps NestJS out of `libs/*` entirely while still giving the container a real dependency graph — one that `composition.spec.ts` compiles on every test run, so a wiring mistake fails a test instead of a deployment.

## 20. The integration event carries only what the consumer needs

The event no longer includes the destination address. `ExecuteWithdrawal` loads the withdrawal by id and reads the address from the aggregate, so publishing it put a destination on a Kafka topic that nothing consumed. Events are external contracts and should carry the minimum that makes them actionable.

## 21. The application owns schema migrations

`docker-entrypoint-initdb.d` runs once, when the data directory is empty. Relying on it meant a developer or environment with an existing volume silently kept an older schema — migration 002 had in fact never been applied to the local `pooleno` database, which returned `42703 undefined_column` on every withdrawal while the test database (dropped and recreated per run) passed.

`SchemaMigrator` applies pending files at startup under an advisory lock and records them in `schema_migrations`, so fresh and long-lived databases converge on the same schema. Seeding moved to the same place behind `SEED_DEV_DATA`, since the tables no longer exist at entrypoint time.

## 22. Redis connects without blocking startup

`await client.connect()` retried indefinitely inside `onModuleInit`, so a Redis outage prevented the service from ever listening — turning an optimisation into a hard startup dependency and breaking the fail-open guarantee exactly when it mattered. The connection is now started without being awaited; requests before it settles are simply not rate limited.

## 23. Shutdown order follows the dependency direction

Nest runs `onModuleDestroy`, then `beforeApplicationShutdown`, then closes the HTTP listener, then `onApplicationShutdown`. Background work is therefore torn down in the *first* hook and shared resources are released in the *last* one, which is the reverse of how they are acquired.

`MessagingLifecycle` stops the consumer, the outbox publisher and the recovery worker in `onModuleDestroy`; `DatabaseConnection` and `RedisConnection` close in `onApplicationShutdown`. The earlier arrangement was inverted — the pool closed while the HTTP server was still accepting requests and the Kafka consumer was still executing withdrawals — so every deploy produced 500s and drove the publisher's timer against a dead pool.

## 24. Writes assert that they changed a row

Every aggregate mutation runs inside a transaction that has already taken `SELECT … FOR UPDATE` on the row it is about to write, so an `UPDATE` matching zero rows is not a business outcome — it means the row is gone or the identity is wrong. `requireSingleRow` raises `STALE_WRITE` and aborts the transaction.

Without it the failure was silent and asymmetric: `ReserveFunds` inserts the reservation regardless, so a no-op wallet `UPDATE` committed a reservation whose `reserved_atomic` was never incremented — funds reserved according to one table and available according to the other.

## 25. Lock hierarchy: wallet before reservation

`ReserveFunds` locks the wallet and then the reservation. Settlement locked them in the opposite order and did not deadlock only because the reservation row in the reserve path is newly inserted and therefore uncontended — an accident of the current call graph, not a property of the design.

The hierarchy is now stated: **wallet → reservation → withdrawal**. Any operation that needs more than one of these takes them in that order. The moment something locks an existing reservation before its wallet — a bulk release, an admin cancellation — the previous arrangement would have been a genuine cycle.

## 26. Recovery claims rather than reads

`findProcessingSince` is an `UPDATE … FOR UPDATE SKIP LOCKED … RETURNING`, matching the lease the outbox publisher already uses.

As a plain `SELECT` it had no exclusion between replicas and never moved `updated_at`, and nothing else moves it for a withdrawal wedged in `PROCESSING`. A stranded withdrawal was therefore re-published by every replica on every cycle, without bound. Re-stamping `updated_at` re-arms the timeout, so a retry costs one event per timeout window. Bounding retries absolutely still needs an attempt counter, which needs a column.
