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

## 27. Identities are branded UUIDs, parsed at the edges

Every identifier is `Uuid<'Name'>` — a `string` at runtime, a distinct type at
compile time. `WithdrawalId` and `ReservationId` are no longer interchangeable,
so `settle(reservationId, withdrawalId)` cannot be called with its arguments
swapped, and `GetWithdrawal.execute(id)` cannot be handed a user id.

The brand is unforgeable outside `parse()`, which is what lets the aggregates
stop checking. Each of `WalletAccount`, `WalletReservation` and `Withdrawal`
carried a private `assertIdentity` static — the same non-blank check, throwing
two different error types, accepting `'wallet-!!!'` as a valid wallet id. All
three are gone. The check happens once, where a raw string crosses into the
system: an HTTP path parameter, a Kafka payload, a database row.

Validation matches the RFC 4122 *layout*, not version 7. New ids are minted as
UUIDv7 for the index locality that time-ordered keys buy, but rows written
before that change hold v4 values and are still valid identities.

`UserId` is branded too, which deviates from the exercise brief: its examples
use `"userId": "user-123"`. This service treats `userId` as an opaque foreign
identity, so nothing forced the choice — typing it uniformly buys one identity
discipline across every table, port and adapter instead of one exception to it.
The seed data and the README examples use UUIDs accordingly. Reverting is a
one-file change: drop the UUID constraint from `UserId` in
`libs/platform/src/identity` and leave `wallets.user_id` as `TEXT`.

## 28. Retryability belongs to the error, not to a list of strings

`CodedError` carries `code` and `retryable`. The Kafka consumer asks
`isRetryable(error)` instead of matching against a hand-maintained set of eight
code *strings* harvested from two libraries it does not import.

That set was wrong in both directions. Renaming a code in a library silently
made it retryable here. And every code nobody remembered to add — an
insufficient balance, an invalid amount, a precision violation — burned the full
retry budget and the backoff delay re-deriving a verdict that could never
change.

The default is deliberate: a `CodedError` is final unless it says otherwise,
because domain and application failures are deterministic. Anything that is
*not* one of ours is retryable, because a driver timeout or a socket reset
carries no verdict and is exactly what redelivery exists for. Today one
application failure opts in — `WITHDRAWAL_EXECUTION_UNRESOLVED`, which means
"we do not know yet" against an idempotent provider.

## 29. The HTTP status table is exhaustive by compilation

`Record<ApiErrorCode, HttpStatus>` in `api-exception.filter.ts`, where
`ApiErrorCode` is composed at the app layer from each library's own union of its
error classes' codes. Adding an error class without deciding its HTTP status
fails `typecheck`.

Before this, nine codes fell through to an unmapped 500 — including
`RESERVATION_NOT_FOUND` and both insufficient-balance failures, which are
ordinary client-visible outcomes. A `500` entry in the table now means
*deliberately* internal; those responses keep their code so operators can find
them, but not their message.

The unions are written against the error classes rather than as a second list of
literals, so they cannot drift from the errors they describe.

## 30. `uuid` is declared by the library that imports it, and nowhere else

Worth recording because the reasoning here was initially wrong.

Webpack externalises workspace-root dependencies, so `import { v7 } from 'uuid'`
inside `libs/platform` becomes a literal `require("uuid")` in
`apps/api/dist/main.js` — verified in the bundle. That looked like it required a
duplicate entry in `apps/api/package.json`, since the app is what runs.

It does not. `pnpm --filter @bitex/api deploy --prod --legacy` — the command the
Dockerfile runs — resolves the workspace graph, so `@bitex/platform`'s
dependencies are installed and linked at the deploy root. Confirmed by deploying
without the duplicate entry and resolving `uuid` from the result. The duplicate
would have been an unused direct dependency: exactly the kind of entry
`@nx/dependency-checks` exists to remove.

The rule that does hold: a package imported only by workspace-root tooling and
never declared by any workspace package will not reach the container.

## 31. Jest transforms `uuid`

`uuid@14` ships ESM only, and these suites run as CommonJS. Every project's
`jest.config.cts` therefore carries
`transformIgnorePatterns: ['node_modules/(?!(\\.pnpm/)?uuid)']`, which hands the
package to `@swc/jest` the same way our own sources are handled. The `.pnpm`
segment is required because pnpm's store puts the package at
`node_modules/.pnpm/uuid@<version>/node_modules/uuid`.

## 32. Terminal transitions emit domain events; the application discharges them

`Withdrawal.complete()` emits `WithdrawalCompleted{reservationId}` and `fail()`
emits `WithdrawalFailed{reservationId}`. `ExecuteWithdrawal` drains them and
reacts in a `switch` that is exhaustive over the union.

Invariant 5.8 of the brief — a failed withdrawal must release its reservation —
was previously an `if`/`else` in an application service. The rule held because
one method happened to be written correctly, and adding a fifth status meant
remembering to extend that method. Now the aggregate states the obligation
*together with the reservation it concerns*, and `assertNever` in the handler
means a new terminal state cannot be added without deciding what becomes of the
reserved funds.

These are domain events, not the wire format: they carry `Money` and `Asset`
rather than decimal strings, and nothing outside `libs/withdrawal` sees them.
The integration event published to Kafka is derived from one of them by the
contract in `src/contracts`, which is the only place the two shapes meet.

`pullDomainEvents()` drains rather than reads. The caller acts on each event
exactly once, inside the transaction that persists the state change that
produced it, so a second drain in the same transaction must return nothing.

## 33. Terminality is defined by the aggregate

`Withdrawal.isTerminal()` replaces the two literal
`status === 'COMPLETED' || status === 'FAILED'` comparisons that lived in
`ExecuteWithdrawal` — the definition of terminality, written outside the
aggregate that owns it, twice. Missing one re-settles a finished withdrawal.

Status vocabularies are declared as `as const` arrays and the unions derived
from them, so the type and its runtime guard cannot drift. `reconstitute` checks
the guard once, because a status arriving from a database row is a claim rather
than a guarantee; `assertState` can then be an exhaustive `switch` rather than a
chain of `if`s ending in a catch-all that accepted anything it had not
considered.

## 34. Aggregates take `now` rather than defaulting to `new Date()`

`startProcessing`, `complete` and `fail` require the caller to supply the time.
A default parameter put an ambient clock inside the domain: a hidden dependency
that made time untestable and let a caller silently bypass the injected `Clock`.

`Withdrawal` and `WalletReservation` also adopt `WalletAccount`'s
validate-then-swap discipline. Both mutated `this.state` in place, so a
transition rejected by a later assertion left the aggregate half-changed — a
status advanced with no provider reference behind it.

## 35. The integration event contract is owned by its producer

`libs/withdrawal/src/contracts/withdrawal-execution-requested.ts` is the single
definition of `WithdrawalExecutionRequested`. `RequestWithdrawal` and
`RecoverStuckWithdrawals` both build through it, the Kafka consumer parses
through it, and the outbox publisher serialises through the platform encoder it
shares.

Previously the same event existed in three places in two shapes: hand-built in
`RequestWithdrawal`, hand-built again in `RecoverStuckWithdrawals` with no test
covering that path, and restated a third time as the consumer's zod schema.
Nothing checked that any of them agreed.

The integration event is derived from the aggregate's own domain event, so the
published fact and the recorded one cannot diverge. Recovery works from a read
model rather than an aggregate, so it rebuilds that domain event first — which
is deliberately more work than writing a second payload, because writing a
second payload is what drifted.

**`z.object`, not `z.strictObject`.** A producer that begins sending an extra
field is a routine additive change. Under strict parsing it dead-letters 100% of
traffic on every consumer not yet redeployed, which makes deployment order
load-bearing for the entire withdrawal pipeline. Unknown fields are ignored.

**`schemaVersion` carries the breaking change instead.** It defaults to 1 when
absent, so messages produced before versioning are read rather than stranded
during a rolling deploy; a version this consumer does not understand fails the
literal and is dead-lettered rather than half-read.

**Amounts cross the wire as decimal strings.** `100.000001` USDT does not
survive an IEEE-754 double, and the atomic-unit scale is the receiver's to
decide from the asset.

## 36. Ports live in `application/ports/`, narrow enough to need no unused stubs

Every port is one file under `application/ports/`, suffixed by role. None is
declared inside a use-case file any more.

`WithdrawalRepository` is split into `WithdrawalAppender` (`add`) and
`WithdrawalMutator` (`getForUpdate`, `save`), both derived from it with `Pick`
so one signature change reaches every view. The adapter implements the whole
thing; each use case depends only on what it calls.

The measurable effect is that no test double contains
`throw new Error('not used')` any more — there were three. A fake forced to
implement methods its subject never calls has stopped describing the
dependency, and the compiler now rejects them.

The `CLAIMED` / `REPLAY` / `CONFLICT` concurrency semantics moved onto the
idempotency port. They were documented in the PostgreSQL adapter, which meant
the contract every implementation must honour was written down as a property of
one implementation.

## 37. `SettleReservation` replaces two identical use cases

`FinalizeReservation` and `ReleaseReservation` were the same seven lines twice:
same collaborators, same lock order, same shape, differing only in which pair of
aggregate methods they called. The composition root then immediately re-fused
them behind one adapter, so the split bought nothing and cost a reader two files
to see one rule.

One use case takes a `'FINALIZE' | 'RELEASE'` outcome and switches on it with
`assertNever`. Naming the outcome keeps the pair visible: every reservation must
eventually receive exactly one of them.

`libs/wallet` now has the same folder-per-slice shape as `libs/withdrawal`, and
its specs are per slice. The settlement spec builds the reserved state directly
instead of running `ReserveFunds` first, so it fails for its own reasons.

## 38. Application errors stay at the application level, not in each slice

`IdempotencyKeyConflictError` is raised only by `RequestWithdrawal`, and
`WithdrawalExecutionUnresolvedError` only by `ExecuteWithdrawal`, so both could
move into their slices. They did not.

`WithdrawalNotFoundError` is genuinely shared, and the other two are part of
contracts that are shared: a key conflict is what the idempotency port promises
for a fingerprint mismatch, and an unresolved execution is the one retryable
failure the Kafka consumer keys its behaviour on. Three small classes in one
clearly named file is less to hold in mind than three files, and it keeps the
`WithdrawalApplicationErrorCode` union in one place.

Domain errors do live with their aggregates, because those are rules rather than
protocol.

## 39. Barrels export explicit names, never `*`

A star export publishes whatever a file happens to declare. That is how both
wallet repository interfaces, every `*Snapshot`, every `*Dependencies` bag —
and `createRequestFingerprint` — became part of a module's public contract
without anyone deciding they should be.

The fingerprint is the clearest case: §14 of this document argues that the
fingerprinting policy must not be reproducible outside the workflow that owns
it, and the barrel published it anyway.

## 40. Each context ships its own Nest module

`libs/*/src/nest/` holds a `DynamicModule` exported at the `./nest` subpath.
Each context declares typed tokens for the ports it needs, constructs its own
use cases from them, and exports only those use cases. The application supplies
adapters and nothing else.

**This supersedes the rationale recorded in `ARCHITECTURE.md`,** which justified
hand-written `useFactory` providers on the grounds that "the libraries need no
NestJS import to be injectable". That property still holds where it matters:
`@nestjs/common` appears in `src/nest/` and nowhere else, so the domain and
application layers remain framework-free and the brief's requirement stays
literally true. What changed is the conclusion drawn from it — a library that
owns a boundary should own its own composition, because the alternative was
`apps/api/src/composition/`: five files and roughly 490 lines of wiring, 31% of
the size of the entire domain, in which adding one dependency to a use case was
a three-part edit in a distant file.

`@nestjs/common` is declared in both `peerDependencies` and `devDependencies`.
`@nx/dependency-checks` computes production dependencies as
`dependencies + peerDependencies`, so `devDependencies` alone reports it
missing; and the application must own the framework version.

Three toolchain mechanics were verified before this landed rather than assumed:
the `./nest` subpath resolves under `nodenext` with the `@bitex/source`
condition (tsc), from `dist` (webpack — checked in the emitted sourcemap) and
under Jest; `@nx/enforce-module-boundaries` applies the same `type:`/`scope:`
tags to a subpath import, confirmed by watching a deliberate
`@bitex/wallet → @bitex/withdrawal/nest` import fail lint; and `provide()`
rejects a swapped dependency order at compile time.

## 41. DI is compile-time checked

`token<Value>(description)` is a branded `symbol` that remembers what it
resolves to; `provide(target, deps, factory)` checks the factory's parameters
against the tokens in `deps` using a `const` tuple parameter.

Nest's `useFactory` correlates a positional `inject: []` array with positional
factory parameters *by hand*. This application did that thirty-one times, once
with five entries. Reordering either side, or changing a token's type, was
caught by nothing until the container resolved at runtime. It is now a type
error.

Tokens replace concrete classes as DI keys throughout. A concrete class used as
a token makes the binding unoverridable in a test and quietly re-introduces the
dependency on the implementation the port existed to remove.

`Clock` and the id generators are real providers. `const clock = { now: () => new Date() }`
sat at module scope in the composition root, closed over by three use-case
factories — bypassing DI entirely, so nothing could substitute it.

The Withdrawal context is composed **once**, in `WithdrawalContextModule`, and
re-exported. Nest keys dynamic modules by generated metadata, and two
structurally similar `forRoot` calls are not a guarantee of one instance — which
here would mean two transaction runners and therefore two `AsyncLocalStorage`
scopes.

## 42. `TransactionalClient` replaces `Pick<PostgresTransactionRunner, 'client'>`

Eight adapters depended on the *shape of a concrete class*, which is the
coupling ports exist to remove. The runner is now published under two tokens:
`TRANSACTION_RUNNER` (the platform port, all the libraries can see) and
`TRANSACTIONAL_CLIENT` (the client accessor, which never leaves the adapter
layer). Two views of one instance, neither of them the class.

## 43. Configuration is one validated object

`apps/api/src/config/app-config.ts` parses every environment variable with zod at
boot. There were twenty-five `process.env` reads across five files, several
inside `@Module` decorators — which means they ran at import time, before a test
could set them, and were invisible to anyone reading the module's providers.

Five production knobs had no environment path at all (outbox batch size, lease
and prune interval; consumer attempts and backoff). All five are now
configurable.

`.env.example` was decorative: nothing loaded it, and it documented a
`DATABASE_URL` default pointing at a port compose does not publish. Compose now
reads it through `env_file`, and it is reconciled against the schema.
Misconfiguration fails at startup naming the variable, instead of surfacing as a
connection timeout in production.

## 44. Kafka topics are provisioned explicitly

Found by booting the rewired application against a fresh broker: it crashed with
"This server does not host this topic-partition". Auto-creation is either
disabled or loses the race with the producer's first metadata request — and when
it did win, it created the topic with **one** partition, which meant the
per-aggregate ordering this design depends on held by accident rather than by
configuration.

`KafkaTopicProvisioner` creates the topic and its DLQ before anything connects,
one at a time: `createTopics` rejects the whole call when any topic in it already
exists, so batching let an existing topic prevent a missing one from being
created. Failure is logged, not thrown, because a managed cluster with
restricted ACLs is a deployment where topics are provisioned out of band.

The main topic gets three partitions by default. Messages are keyed by
`withdrawalId`, so one aggregate's lifecycle stays on one partition however many
there are; the DLQ gets one, because ordering across dead letters means nothing.
