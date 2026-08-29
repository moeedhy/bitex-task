# Bitex Withdrawal Backend — Architecture Review & Refactor Plan

## Context

`docs/TASK.md` is the Pooleno senior-backend challenge: a digital-asset withdrawal
workflow judged on DDD (20%), wallet correctness and concurrency (20%), PostgreSQL
transaction design (15%), idempotency (15%), Kafka + Outbox (10%), Node/NestJS
quality (10%), testing (5%), Redis (2%), docs (3%). The audience is a CTO deciding
whether to hire.

The current implementation is already **upper-quartile**. Three independent reviews
(domain/application, spec-compliance/testing, infrastructure) found **zero** of the ten
"weak submission" markers in TASK.md §23 and eleven of twelve "excellent submission"
markers in §22. Money is exact `bigint`, the wallet locks with `SELECT … FOR UPDATE`,
the outbox is real, the consumer deduplicates on `processed_events`, and module
boundaries are enforced by `@nx/enforce-module-boundaries` rather than by convention.
The concurrency test is genuine — two `Promise.allSettled` requests against real
PostgreSQL, asserting the end state of the wallet row.

What separates it from "hire" is **finish**, not thinking:

1. **The conventions stopped one refactor short of their own plan.** `docs/plans/IMPLEMENTATION_PLAN.md`
   specifies `WithdrawalId` / `UserId` / `ReservationId` in every port signature.
   `libs/platform/src/brand/brand.ts` ships the `Brand<>` helper, exports it publicly —
   and it has **zero usages**. Every identifier in the system is a bare `string`;
   `FinalizeReservation.execute(reservationId)` and `GetWithdrawal.execute(id)` are
   assignment-compatible. `uuid@^14` is a production dependency that is never imported.
2. **The `WithdrawalExecutionRequested` contract exists in three places in two shapes**
   and nothing compile-checks that they agree.
3. **Seven use cases have four different input/output conventions**, six ports live in
   six different locations under three naming schemes, and `libs/withdrawal` is packaged
   differently from its two siblings.
4. **The tests that matter don't run.** Both integration files are gated on
   `TEST_DATABASE_URL` and there is no CI workflow, so `nx run-many -t test` reports green
   with the §14-mandated concurrency test skipped.
5. **Four documentation claims are falsifiable in under five minutes** (listed in Phase 6).
6. **There are two shutdown-path blockers and a silent money-losing `UPDATE`** that review
   found and no test would have caught, because nothing automated exercises the shutdown
   path or asserts an `UPDATE` matched a row. All are listed with evidence in Phase 0.5.

And the app is not thin. Non-test source, measured:

```text
libs/platform/src              344
libs/wallet/src                433
libs/withdrawal/src            801      →  1,578 total in libraries
apps/api/src/app               153
apps/api/src/composition       485
apps/api/src/infrastructure  1,420      →  2,058 total in the app
```

`apps/api` carries more code than all three libraries combined, and `composition/` alone —
pure wiring — is 485 lines, 31% of the size of the entire domain. Twenty-one `process.env`
read sites are spread across five files, several of them inside `@Module` decorators.

This plan fixes all of it and moves the composition weight out of `apps/api` into the
libraries that own it.

---

## Review verdict — the twelve metrics

| # | Metric | Now | Principal evidence |
|---|---|---|---|
| 1 | **DDD** | B+ | Real aggregates with behaviour. But invariant §5.8 ("a failed withdrawal must release its reservation") lives *only* in an application `if/else` at [execute-withdrawal.ts:103](libs/withdrawal/src/application/execute-withdrawal/execute-withdrawal.ts:103); no domain events anywhere; invariant §5.1 is enforced by the **wallet** aggregate, not the withdrawal one, because `reserve()` runs before `Withdrawal.request()`. |
| 2 | **Hexagonal** | B | Dependency direction is correct *and lint-enforced*. But `WithdrawalView` and `RequestWithdrawalResult` are HTTP wire shapes living in the application layer and returned verbatim by the controller — no seam at the driving edge. |
| 3 | **Vertical slices** | C | `libs/withdrawal` is folder-per-use-case; `libs/wallet` is flat layered. Undeclared and unexplained. Withdrawal's slicing is itself incomplete — three slices' errors share one `withdrawal.errors.ts`. |
| 4 | **Cognitive complexity** | B− | `ExecuteWithdrawal.prepare()`/`settle()` duplicate a four-line dedup+terminal+record guard; `RequestWithdrawal.execute` is one 60-line closure spanning six abstraction levels, building `payload` and `result` five lines apart with near-identical fields kept in sync by eye. |
| 5 | **Cognitive load** | C+ | Understanding `RequestWithdrawal.execute` requires six other files — and the semantics that make it correct (`CLAIMED`/`REPLAY`/`CONFLICT` under concurrency) are documented in the *adapter*, not the port. Comment-to-code ratio exceeds 1:1 in several files, and several comments encode invariants nothing enforces. |
| 6 | **LCOM** | C+ | `ExecuteWithdrawal` has six collaborators and no method touches more than five; `provider` is used by one method, `walletSettlement` by one. `FinalizeReservation` and `ReleaseReservation` are the same class twice, re-fused immediately by `WalletSettlementAdapter`. |
| 7 | **TASK.md** | A− | All endpoints, all nine invariants enforced somewhere, real concurrency strategy, outbox, DLQ, recovery worker. Losses: no `test/` dir (§19), consumer idempotency never tested through the consumer, observability half-built (§15). |
| 8 | **YAGNI** | B− | `Brand` unused; `uuid` unimported; 8 unused `Money`/`Asset` methods; `IntegrationEvent<Payload>` generic where every site takes the default; `PostgresWithdrawalRepository.getById` dead; `destination_address` selected and mapped in `postgres-stuck-withdrawal-query.ts` but absent from its own port type. |
| 9 | **KISS** | B | Two lookup methods differing only by key (`getForUpdate` means "by user+asset" in one repository and "by id" in two others — a trap); hand-rolled netstring encoding in `request-fingerprint.ts`; five defensive `Date` copies protecting a field nothing mutates. |
| 10 | **SOLID** | B− | ISP: `WithdrawalRepository` is wide enough that test doubles need `throw new Error('not used')` stubs. OCP: adding a failure reason touches five places, and `fail()` re-checks at runtime a fact its parameter type already states. DIP: the exception filter and the Kafka consumer each hand-maintain a registry of error-code *string literals* harvested from libs they never import — **and eight adapters take `Pick<PostgresTransactionRunner,'client'>`, depending on the shape of a concrete class because no `TransactionalClient` interface exists.** |
| 11 | **DX** | C | Three `package.json` files disagree on `type`, `main`, `exports` and `tslib`; two test runners with both Nx plugins claiming `test`; the README's documented test command fails on `@bitex/platform`; adding a use case has seven steps and six have no unambiguous precedent. |
| 12 | **Change amplification** | Mixed | *Excellent* for a second asset (2 files — deriving `Asset` from `Money` pays off exactly here). *Poor* elsewhere: a new withdrawal state touches 9 files, and the two literal `status === 'COMPLETED' \|\| status === 'FAILED'` checks in `ExecuteWithdrawal` are the terminal-state definition expressed in the application layer — forget one and a finished withdrawal re-settles. A flat fee touches 14+. The `withdrawals` row is also decoded by **three independent mappers** (repository, read-model query, stuck query), each restating the column list and the `resolveAsset` + `Money.fromAtomicUnits` conversion. |
| — | **NestJS / DI** | C | ~190 lines of hand-written `useFactory` + `new` in [withdrawal.module.ts](apps/api/src/composition/withdrawal.module.ts); concrete classes used as DI tokens; `process.env` read inside `@Module` decorators in three files; `const clock` and `const ids` are module-scope literals that bypass DI entirely; adding one dependency to a use case is a three-part edit in a distant file. |

---

## Design decisions (settled)

| Decision | Choice | Consequence |
|---|---|---|
| Nest wiring | **Libs ship their own Nest modules** via a `./nest` subpath export | `apps/api` becomes wiring-of-adapters only. `@nestjs/common` appears in `libs/*/src/nest/` *and nowhere else* — domain and application layers stay framework-free, so TASK.md §4.2 stays literally true. **This reverses a documented decision**: `ARCHITECTURE.md:30-33` currently justifies `useFactory` on the grounds that "the libraries need no NestJS import to be injectable". Phase 6 supersedes that entry rather than silently contradicting it — the new rationale is that a library that owns a boundary should own its own composition, and confining Nest to `src/nest/` preserves the purity the old entry was protecting. |
| Identity | **Branded types, UUIDv7 everywhere, including `UserId`** | Time-ordered primary keys, `UUID` columns, and `WithdrawalId`/`ReservationId` stop being interchangeable. **See "Accepted risk" below.** |
| Event contracts | **Producer owns them** | `libs/withdrawal/src/contracts/` is the single definition; the outbox publisher and the consumer both import it, so they cannot drift. |
| Validation | **zod in the application layer, never in domain** | Enforced by an ESLint `no-restricted-imports` rule on `**/domain/**`, matching this repo's existing "enforced rather than reviewed" ethos. |

### Accepted risk, stated once

TASK.md's own examples use `"userId": "user-123"` — not a UUID. Branding `UserId` as a
UUIDv7 means the seed user, the README curl examples and `docs/` samples all change to a
fixed UUID. A reviewer comparing the spec's sample payload to ours will see a difference.
The plan proceeds as decided; **Phase 6 adds a `DECISIONS.md` entry stating the deviation
and why** (this service treats `userId` as an opaque foreign identity today, and typing it
uniformly buys a single ID discipline across every table and port). If that trade is
unwanted, the only change needed is to keep `UserId = Brand<string,'UserId'>` without the
UUID constraint and leave `wallets.user_id` as `TEXT` — a one-file change to
`libs/platform/src/identity/`.

---

## Target structure

```text
libs/platform/src/
  identity/          Brand, Uuid, uuidv7 factory, cross-context ID types
  money/             Money, Asset, Assets            (unchanged, trimmed)
  errors/            CodedError base + ErrorCode union
  events/            IntegrationEvent envelope + encode/decode
  ports/             Clock, IdGenerator<Id>, TransactionRunner, Outbox
  nest/              typed token() + provide() helpers, PlatformModule

libs/wallet/src/
  domain/            WalletAccount, WalletReservation, WalletId, errors
  application/
    ports/           wallet.repository.ts, wallet-reservation.repository.ts
    reserve-funds/   reserve-funds.ts + .contract.ts + .spec.ts
    settle-reservation/
  nest/              WalletModule + tokens
  index.ts

libs/withdrawal/src/
  domain/            Withdrawal (+ domain events), WithdrawalAddress, errors
  contracts/         WithdrawalExecutionRequested v1 (schema + factory + parser)
  application/
    ports/           one file per port, *.port.ts
    request-withdrawal/  execute-withdrawal/  get-withdrawal/  recover-stuck-withdrawals/
  nest/              WithdrawalModule + tokens
  index.ts

apps/api/src/
  main.ts            bootstrap only
  http/              controller, DTOs + mappers, exception filter, rate-limit guard,
                     correlation-id middleware
  adapters/          postgres/ kafka/ redis/ provider/   (adapters only — no policy)
  app.module.ts      imports lib modules, binds adapters to their tokens
```

### Conventions charter (to be written to `docs/CONVENTIONS.md`)

These are the rules the refactor applies uniformly. They are the deliverable, not
incidental cleanup.

**Identity.** Every ID is `Uuid<'Name'>` from `libs/platform/src/identity`. Minted only
through `IdGenerator<'Name'>`; parsed at system edges through `WithdrawalId.parse(raw)`.
Cross-context identities (`UserId`, `WithdrawalId`, `ReservationId`, `EventId`,
`IdempotencyKey`) live in platform; context-private ones (`WalletId`) live in their own lib.
This deletes the three duplicated `assertIdentity` private statics that today throw two
different error types for the same check.

**Use cases.** One class per slice, `execute(command: XCommand): Promise<XResult>`, a single
`XDependencies` object destructured in the constructor to private fields. `XCommand` /
`XResult` are declared in `<slice>/<slice>.contract.ts`. No positional string parameters,
no anonymous inline input types. Applies to `libs/wallet` too — `ReserveFunds` currently has
an unnamed input shape that `WalletReservationPort` restates structurally and
`WalletReservationAdapter` restates a third time via `Parameters<…>[0]`.

**Ports.** All in `application/ports/`, one per file, suffix by role: `*Repository`
(aggregate persistence), `*Query` (read model), `*Port` (consumer-owned capability). Never
declared inside a use-case file. Ports are narrow enough that no test double needs a
`throw new Error('not used')` stub — split `WithdrawalRepository` accordingly.

**Errors.** All extend `CodedError` with a `code: ErrorCode` and a `retryable: boolean`.
`ErrorCode` is an exported union; the HTTP filter's map is `Record<ErrorCode, HttpStatus>`
so a missing entry is a compile error, and the Kafka consumer reads `error.retryable`
instead of matching a hand-copied string set. Failures throw; the one Result-shaped return
(`IdempotencyClaim`) stays, and its justification stays in `DECISIONS.md`.

**Contracts.** Integration events are owned by the producing context, carry an explicit
`schemaVersion`, and expose `build()` / `parse()` from one module. The consumer parses
with a version check rather than `strictObject`, so an additive producer change stops
dead-lettering 100% of traffic.

**Presentation.** `apps/api/src/http/dto/` holds request and response DTOs with explicit
mappers. Application results stop being the wire format.

**Files.** kebab-case; role suffix where a role exists (`.repository.ts`, `.port.ts`,
`.contract.ts`, `.errors.ts`, `.module.ts`); adapters prefixed by technology
(`postgres-`, `kafka-`, `redis-`). Barrels use explicit named exports, never `export *` —
today the barrels publish `createRequestFingerprint` (the exact policy `DECISIONS.md`
argues must not be reproducible outside the workflow), both wallet repository interfaces,
all three `*Snapshot` types and every `*Dependencies` bag.

---

## Phased work plan

Each phase ends green on `pnpm nx run-many -t lint typecheck test`.

### Phase 0 — Make the safety net real *(do this first — it protects every later phase)*

- Add `.github/workflows/ci.yml`: `postgres:16` + `redis` + a single-node Kafka service,
  `TEST_DATABASE_URL` exported, running `lint typecheck test` across all projects. Without
  this, every phase below is unverified — today `nx run-many -t test` reports green while
  the §14 concurrency test is skipped.
- Standardize on **one test runner (Jest + `@swc/jest`)**: three of four projects already
  use it, SWC handles decorator metadata correctly for the Nest code, and `nx.json`
  currently registers both `@nx/vitest` and `@nx/jest` against the same `test` target name.
  Convert `libs/platform` from Vitest, drop the `@nx/vitest` plugin entry and the
  vitest/vite devDependencies, and fix `README.md:60` (`--runInBand` is Jest-only and
  currently fails on `@bitex/platform`).
- Align the three lib `package.json` files: `libs/withdrawal` gains `"type": "module"`,
  the `dist` `main`/`types`, the `@bitex/source` export condition, `tslib`, and an `nx.name`.
- Strengthen the concurrency test to assert *which* error the losing request got — today a
  `lock_timeout` expiry would satisfy the assertion identically to
  `InsufficientAvailableBalanceError`.

### Phase 0.5 — Correctness bugs found during review *(fix before any restructuring)*

These are defects, not style. Each was verified against the source. They are also the most
valuable thing in this plan for the audience: "I reviewed my own submission and found these"
is a stronger signal than any refactor.

| Sev | Bug | Evidence | Fix |
|---|---|---|---|
| **Blocker** | **Shutdown phase inversion.** `DatabaseConnection` and `RedisConnection` tear down in `onModuleDestroy`; `MessagingLifecycle` tears down in `onApplicationShutdown`. Nest runs `onModuleDestroy` → *HTTP close* → `onApplicationShutdown`, so **the pool is ended while the HTTP server is still accepting and the Kafka consumer is still executing withdrawals.** Every deploy 500s in-flight requests and runs the consumer against a dead pool. | [database-connection.ts:49](apps/api/src/infrastructure/shared/database-connection.ts:49) vs [messaging.module.ts:44](apps/api/src/composition/messaging.module.ts:44) | Consumer/publisher/worker stop in `onModuleDestroy`; pool and Redis close in `onApplicationShutdown`. |
| **Blocker** | **Unhandled rejection kills the process.** `setInterval(() => void this.publishOnce(), …)` with no `try`/`catch` anywhere inside `publishOnce`. Any pool error becomes an unhandled rejection → exit. Guaranteed to fire during the shutdown above, because the timer ticks after `pool.end()`. `StuckWithdrawalRecoveryWorker.runOnce` gets this right — the publisher does not. | [outbox-publisher.ts:79-131](apps/api/src/infrastructure/messaging/outbox-publisher.ts:79) | Guard the tick body; also `this.timer = undefined` in `stop()` and a re-entrancy guard in `start()`. |
| **Major** | **Silent no-op `UPDATE` on all three money-bearing tables.** No `save()` checks `rowCount`. In `ReserveFunds`, a wallet update that matches zero rows still commits the reservation insert — a reservation exists whose `reserved_atomic` was never incremented, with no error anywhere. The idempotency adapter *does* check ([postgres-idempotency.ts:105](apps/api/src/infrastructure/withdrawal/postgres-idempotency.ts:105)); the pattern was applied to the one table that holds no money and skipped on the three that do. | [postgres-wallet-repository.ts:44-56](apps/api/src/infrastructure/wallet/postgres-wallet-repository.ts:44), and the reservation/withdrawal equivalents | `if (rowCount !== 1) throw`. |
| **Major** | **`FOR UPDATE` on the idempotency replay path.** The re-read locks a row that is immutable once `COMPLETED`, and holds it for the whole outer transaction. A client retry-storm on one key serialises against `lock_timeout = 3000ms` and turns cheap replays into `55P03` → unmapped → HTTP 500. The `ON CONFLICT` insert has already waited for the in-flight writer. | [postgres-idempotency.ts:65-71](apps/api/src/infrastructure/withdrawal/postgres-idempotency.ts:65) | Drop the lock, or `FOR SHARE`. |
| **Major** | **Recovery amplifies without bound.** The stuck scan has no `FOR UPDATE SKIP LOCKED` and no claim marker, and recovery never bumps `withdrawals.updated_at` — so a wedged withdrawal is re-published by *every replica* on *every* 60s tick, forever. The README names the missing attempt counter; the missing `SKIP LOCKED` is not mentioned. | `postgres-stuck-withdrawal-query.ts` + `stuck-withdrawal-recovery-worker.ts` | `SKIP LOCKED` + a `recovery_attempted_at` column with backoff and an attempt cap. |
| **Major** | **Two client-visible error-contract bugs.** The missing-`Idempotency-Key` 400 and the rate-limit 429 are thrown as `new HttpException('…', status)`, whose `getResponse()` is a **string** — so those two responses are a bare JSON string with no `errorCode`, while every other error gets `{statusCode, errorCode, message}`. Zod messages also drop `issue.path`, so a client never learns which field failed. And the code→status lookup is a plain object literal, so `code: 'constructor'` resolves to a function and throws *inside the filter*. | [api-exception.filter.ts:28-54](apps/api/src/app/api-exception.filter.ts:28), [withdrawals.controller.ts:51](apps/api/src/app/withdrawals.controller.ts:51) | One envelope; `Map` or `Object.hasOwn`; include `issue.path`; move Zod to a `ZodValidationPipe`. |
| **Major** | **`.env.example` is decorative.** Nothing loads it — no `dotenv`, no `@nestjs/config`, no `env_file:` in compose. Its 25 documented variables take effect only if exported by hand, and the code default for `DATABASE_URL` points at **5432** while compose publishes **55433**. Five production knobs (outbox `batchSize`/`leaseSeconds`/`pruneIntervalMs`, consumer `maxAttempts`/`backoffMs`) have no env path at all. | `.env.example`, [persistence.module.ts:32](apps/api/src/composition/persistence.module.ts:32) | Subsumed by the `AppConfig` work in Phase 4 — but the missing loader is a bug today. |
| **Minor** | **Build is not reproducible.** `corepack enable` with **no `packageManager` field** anywhere in the workspace (verified absent), so the pnpm version is whatever corepack's bundled list resolves to — against a lockfile written by a different major. `COPY . .` before `pnpm install` also busts the dependency layer on every source edit. | `Dockerfile:3-5` | Pin `packageManager`; copy manifests → install → copy sources. |
| **Minor** | **No lock hierarchy.** `ReserveFunds` locks wallet → reservation; settlement locks reservation → wallet. No deadlock today *only* because the reservation row in the reserve path is brand-new and uncontended — an accident, not a design. | `reserve-funds.ts` vs `finalize-reservation.ts` | Write the hierarchy into `DECISIONS.md` and make settlement follow it. |
| **Minor** | No health/readiness endpoint, no `HEALTHCHECK`, no Kafka volume or explicit topic creation (auto-create gives **1 partition**, so the documented per-aggregate ordering is accidental), and `processed_events` / `idempotency_records` have no retention while `outbox_events` does. | — | `@nestjs/terminus`; explicit topic; retention parity. |

### Phase 1 — Platform: identity, errors, events

- `libs/platform/src/identity/`: `Brand`, `Uuid<Name>`, an `IdGenerator<Id>` port typed to
  its brand, and a `uuidv7` factory (`import { v7 } from 'uuid'` — the dependency is
  already installed and unused). Per-ID `parse()` helpers replace the three duplicated
  `assertIdentity` statics.
- `libs/platform/src/errors/`: abstract `CodedError` + the exported `ErrorCode` union +
  `retryable`. Migrate all 23 error classes onto it.
- `libs/platform/src/events/`: `IntegrationEvent<Type, Payload>` (drop the unused generic
  default) and the `encodeIntegrationEvent` / `decode` pair — today the wire flattening
  lives in `outbox-publisher.ts` and the parsing in the consumer, with the payload built by
  hand in two application files.
- `libs/platform/src/nest/`: `token<T>(description)` and a variadic-tuple `provide()` helper
  so DI wiring is **compile-time type-checked** rather than positional `inject: []`
  correlation. This is what removes the boilerplate, not just relocates it.
- Delete the dead surface: `IntegrationEvent`'s default type param, the 8 unused
  `Money`/`Asset`/`WithdrawalAddress` methods, the two-hop `brand/index.ts` barrel.

### Phase 2 — Domain: events, terminality, invariant 8

- `Withdrawal` records domain events. `complete()` emits `WithdrawalCompleted{reservationId}`,
  `fail()` emits `WithdrawalFailed{reservationId}`, `request()` emits
  `WithdrawalExecutionRequested`. `pullDomainEvents()` drains them.
  **This is the single most important change in the plan**: it converts TASK.md §5.8 from
  an application `if/else` into a domain fact, and it answers §24.14 ("which rules are
  enforced inside aggregates rather than application services?") properly.
- Add `Withdrawal.isTerminal()`; replace both literal `status === 'COMPLETED' || status === 'FAILED'`
  comparisons in `ExecuteWithdrawal`. These are the highest change-amplification risk in the
  codebase.
- Apply the validate-then-swap `commit()` discipline from `WalletAccount` to `Withdrawal`
  and `WalletReservation`, which mutate in place today.
- Derive status unions from `as const` arrays so the type and its runtime guard cannot drift.
- Rewrite `Withdrawal.assertState` as a `switch` with `assertNever` — `assertNever` already
  exists in platform and is currently used in exactly one place, none of them this one.
- Make `now` a required parameter on aggregate methods; drop the `= new Date()` defaults that
  put an ambient clock inside the domain.

### Phase 3 — Application: slices, ports, contracts

- **Contracts.** `libs/withdrawal/src/contracts/withdrawal-execution-requested.ts` becomes the
  one definition: zod schema, `schemaVersion`, `build(withdrawal)` and `parse(raw)`. Both
  `RequestWithdrawal` and `RecoverStuckWithdrawals` build through it; the Kafka consumer
  parses through it. The existing `event-contract.spec.ts` — the best test in the repo —
  extends to cover the recovery path too.
- **Ports.** Move all inline port declarations into `application/ports/*.port.ts`. Split
  `WithdrawalRepository` so `RequestWithdrawal` no longer depends on `getForUpdate`/`save`
  it never calls and `ExecuteWithdrawal` no longer depends on `add`.
- **Slices.** Give `libs/wallet` the same folder-per-use-case shape. Merge
  `FinalizeReservation` + `ReleaseReservation` into one `SettleReservation` taking a
  `'FINALIZE' | 'RELEASE'` outcome, and delete `WalletSettlementAdapter`'s fan-in.
  Move slice-specific errors into their slices.
- **Cognitive complexity.** Extract `ExecuteWithdrawal`'s duplicated
  dedup + terminal + record guard into one `loadSettleable()`; split `RequestWithdrawal.execute`
  so the idempotency protocol, the reservation, and the persistence step read at one level.
- **Invariant §5.1 in the right aggregate.** Construct the `Withdrawal` *before* reserving,
  so a non-positive amount fails with a withdrawal-domain error rather than
  `INVALID_WALLET_AMOUNT` leaking out of the wallet module through a withdrawal endpoint.
  Add the matching HTTP-edge check that `DECISIONS.md:47` already claims exists.
- Named `*Command`/`*Result` types for all seven use cases, in `.contract.ts` files.

### Phase 4 — Nest modules move into the libs

- `libs/platform/src/nest/PlatformModule`, `libs/wallet/src/nest/WalletModule`,
  `libs/withdrawal/src/nest/WithdrawalModule`, each exported at the `./nest` subpath with
  `@nestjs/common` scoped to that folder only.
- Each module declares its own typed tokens (`WITHDRAWAL_REPOSITORY`, `WALLET_REPOSITORY`,
  `WITHDRAWAL_PROVIDER`, …) and constructs its use cases from them. `apps/api` supplies the
  adapter bindings and nothing else.
- `Clock` and `IdGenerator` become real providers, replacing the module-scope `const clock`
  and `const ids` literals that bypass DI and cannot be overridden in tests.
- **Typed configuration.** One zod-validated `AppConfig` provider replaces
  `process.env` reads scattered inside three `@Module` decorators and the two-function
  hand-rolled `env.ts`. Reconcile `.env.example` against every variable actually read.
- `apps/api/src/composition/` disappears; `apps/api/src/infrastructure/` becomes
  `apps/api/src/adapters/`, holding adapters only. **The rename has two non-obvious
  followers**: the `Dockerfile` copies `apps/api/src/infrastructure/database` to `/app/sql`,
  and `DATABASE_MIGRATIONS_DIR` / `DATABASE_SEED_PATH` defaults are relative paths in
  `persistence.module.ts` and `.env.example`. All four must move together or the container
  boots and fails on migration.
- **Policy currently in the app moves to the libs it belongs to:**
  | Today | Destination |
  |---|---|
  | `NON_RETRYABLE_CODES` string set in the consumer | `CodedError.retryable` (Phase 1) |
  | Error-code → HTTP status map, missing 9 codes | exhaustive `Record<ErrorCode, HttpStatus>` |
  | Wire-envelope flattening in `outbox-publisher.ts` | `platform/events` + `withdrawal/contracts` |
  | `WalletReservationAdapter` / `WalletSettlementAdapter` | collapse into `libs/wallet`'s Nest module bindings |
  | `FAKE_PROVIDER_OUTCOME` env read in a `@Module` decorator | `AppConfig` |

### Phase 5 — HTTP, observability, operations

- Response DTOs + mappers in `apps/api/src/http/dto/`; the controller stops returning
  application types verbatim.
  **Careful here:** `RequestWithdrawalResult` currently serves *three* roles — use-case
  return value, HTTP response body, **and the durable `response_payload` JSONB** rebuilt
  field-by-field on replay
  ([postgres-idempotency.ts:85-94](apps/api/src/infrastructure/withdrawal/postgres-idempotency.ts:85)).
  Introducing an HTTP DTO must not silently redefine the stored format. Split it explicitly:
  the application returns a domain-shaped result, the idempotency adapter persists a
  versioned `StoredIdempotentResponse`, and the controller maps to the wire DTO. Three roles,
  three types, one of which is now safe to evolve without a data migration.
- Rate limiting becomes a **Nest guard** behind a port; the controller stops injecting the
  concrete `RedisRateLimiter`.
- `correlationId` propagation via `AsyncLocalStorage`: middleware → use case → `outbox_events`
  row → Kafka header → consumer log. Today it is generated in `main.ts` and dies at the
  controller, which is exactly the half of the flow that does not need it.
- Add a logger to `ApiExceptionFilter` — every HTTP failure is currently invisible.
- Wrap `OutboxPublisher.publishOnce` in a top-level try/catch: it runs under
  `setInterval(() => void this.publishOnce(), …)` with no guard, so a transient PostgreSQL
  blip during a tick becomes an unhandled rejection that kills the API.
  `StuckWithdrawalRecoveryWorker` already gets this right.

### Phase 6 — Schema, docs, and the record

- **Migrations — add `004_uuid_identity.sql`, do not squash.** `SchemaMigrator.run` records
  applied versions **by filename** ([schema-migrator.ts:44-60](apps/api/src/infrastructure/shared/schema-migrator.ts:44)),
  so replacing `001`–`003` with a squashed baseline would leave any existing volume with the
  old three filenames marked applied and a new unrecognised filename that then runs against a
  populated database and fails. Squashing would require a documented `docker compose down -v`,
  which contradicts the migrator's entire stated purpose
  ([schema-migrator.ts:14-18](apps/api/src/infrastructure/shared/schema-migrator.ts:14)).

  A converting `ALTER … TYPE uuid USING id::uuid` is also not viable: existing seed rows carry
  `user-123`, which is not a valid UUID and throws.

  So `004` **rebuilds**: drop and recreate the tables with `UUID` columns, guarded and
  documented in its own header as a deliberate pre-release identity change on a service with
  no deployed instance. This works on a fresh volume and on an existing one, keeps the
  `schema_migrations` bookkeeping honest, and keeps the advisory lock and migrate-at-startup
  mechanism intact — the mechanism is one of this repo's genuine strengths and should not be
  collateral damage. Update `seed.sql` to a fixed UUIDv7 demo user in the same phase.
- Fix the falsifiable documentation claims:
  - `DECISIONS.md:47` — "the HTTP edge rejects non-positive request amounts". It does not
    (fixed in Phase 3; the claim becomes true).
  - `ARCHITECTURE.md:66` — "**every** transaction sets `lock_timeout`/`statement_timeout`".
    Only `PostgresTransactionRunner`'s do; the outbox publisher's raw `BEGIN`/`COMMIT` and the
    migrator's do not — and the publisher is precisely the process the paragraph says the
    limits protect.
  - `ARCHITECTURE.md:103` — structured context on infrastructure failures, and correlation-id
    propagation. Both become true in Phase 5.
  - `DECISIONS.md` duplicate section numbers 11 and 12.
  - `ai/AI_USAGE.md:3` names one tool while the repo carries config for several.
  - `docs/plans/APPLICATION_PLAN.md:371` lists outbox pruning as future work; it is implemented.
- Add `docs/CONVENTIONS.md` (the charter above) and `DECISIONS.md` entries for: branded
  UUIDv7 identity and the `user-123` deviation, libs shipping their own Nest modules
  (superseding the `useFactory` rationale at `ARCHITECTURE.md:30-33`), and producer-owned
  event contracts.
- `DOMAIN_MODEL.md` gains a **Domain events** section (`WithdrawalExecutionRequested`,
  `WithdrawalCompleted`, `WithdrawalFailed` and how invariant §5.8 rides on them) and an
  **Identity** section. `ARCHITECTURE.md`'s container diagram and disk-layout block both
  change with Phase 4. `TASK.md` §24's fifteen interview questions are a useful final
  checklist — every one should be answerable from `docs/` alone after this phase.
- Create `test/` (TASK.md §19 names it as a deliverable) holding the two
  `*.integration.spec.ts` files, or state the decision in `README.md` — it currently declines
  the directory, which is defensible but costs a literal checkbox for nothing.
- README: correct the test command, the seeded user, and the API examples.

---

## Verification

```bash
pnpm nx run-many -t lint typecheck build
```

```bash
docker compose up -d postgres redis kafka
```

```bash
TEST_DATABASE_URL=postgresql://pooleno:pooleno@localhost:55433/pooleno_test pnpm nx run-many -t test
```

Then end-to-end against a live stack:

```bash
docker compose up --build
```

- `POST /withdrawals` with a fresh `Idempotency-Key` → `201` + `PENDING`.
- Replay the **same** key and body → identical response, and `SELECT count(*) FROM withdrawals` unchanged.
- Same key, **different** amount → `409`.
- Poll `GET /withdrawals/{id}` → `COMPLETED` with a `transactionReference`, and
  `SELECT balance_atomic, reserved_atomic FROM wallets` shows the debit with `reserved = 0`.
- `FAKE_PROVIDER_OUTCOME=FAILED` → `FAILED`, and `reserved_atomic` returns to `0` with
  `balance_atomic` unchanged.
- Republish an already-processed outbox row by hand → consumer logs a skip, no second debit.
- Two concurrent 80-USDT requests against a 100-USDT wallet → exactly one succeeds
  (asserted in CI, not just locally), **and the loser fails with
  `InsufficientAvailableBalanceError`** — not a `lock_timeout`, which today would satisfy the
  assertion identically.
- **Graceful shutdown** (regression test for the Phase 0.5 blockers): `docker compose stop`
  with the outbox timer running and a request in flight → clean exit, no unhandled rejection,
  no 500. This path has never been exercised.
- **`rowCount` guard**: point a wallet `save()` at a non-existent id in a test and assert it
  throws rather than committing silently.
- Send `Idempotency-Key` with a `Content-Type` mismatch and a bad field → the 400 body is the
  same `{statusCode, errorCode, message}` envelope as every other error, and the Zod message
  names the offending field.

Boundary and convention rules are verified by `lint`, not by review: the `type:`/`scope:` tag
constraints, the new `no-restricted-imports` ban on zod under `**/domain/**`, and the
exhaustive `Record<ErrorCode, HttpStatus>` which fails `typecheck` if a code is unmapped.

---

## Confirm before starting Phase 4

Three toolchain mechanics are load-bearing for the "libs ship their own Nest modules"
decision and should be proven with a throwaway spike (30 minutes) before the phase is
committed to. None of them changes the design if they behave; each has a known fallback.

1. **Subpath exports under `nodenext` + `customConditions: ["@bitex/source"]`.** Each lib's
   `exports` map needs a `"./nest"` entry mirroring the `"."` entry's condition order. Confirm
   that `apps/api`'s webpack build resolves `@bitex/withdrawal/nest`, and that
   `@nx/js:copy-workspace-modules` / `prune-lockfile` (see `apps/api/package.json` targets)
   carry the subpath into the Docker image. *Fallback if not:* one entrypoint per lib with the
   Nest module re-exported from the root barrel, and the "no Nest in libs" rule enforced by
   lint on the `application/` and `domain/` folders instead of by packaging.
2. **`@nx/enforce-module-boundaries` and subpaths.** Confirm the plugin resolves
   `@bitex/withdrawal/nest` to the same project (and therefore the same `type:`/`scope:` tags)
   as `@bitex/withdrawal`. *Fallback:* an explicit entry in the rule's config.
3. **`@nestjs/common` placement.** It should be a `peerDependency` of each lib (satisfied by
   `apps/api`), not a `dependency` — otherwise `prune-lockfile` can hoist a second copy and
   Nest's `InjectionToken` identity checks break across module instances. Verify with a
   `pnpm why @nestjs/common` after wiring.

These are also exactly the questions to answer in `DECISIONS.md` when recording the reversal
of the current `useFactory` rationale.

---

## The plan, reviewed against the twelve metrics

| # | Metric | Effect |
|---|---|---|
| 1 | DDD | Invariant §5.8 moves into the aggregate via domain events; the event contract is derived from the aggregate instead of hand-built twice; invariant §5.1 moves to the aggregate that owns it. |
| 2 | Hexagonal | A real seam appears at the driving edge (response DTOs). Ports get one home and one naming rule. `@nestjs/common` enters libs but is confined to `src/nest/`, so the domain-purity requirement of §4.2 holds. |
| 3 | Vertical slices | One shape across both module libs, with slice-owned errors and contracts. |
| 4 | Cognitive complexity | Removes the duplicated guard in `ExecuteWithdrawal`, splits the 60-line closure, and turns `assertState` into an exhaustiveness-checked switch. |
| 5 | Cognitive load | Fewer files to read per use case; the `CLAIMED`/`REPLAY`/`CONFLICT` semantics move onto the port where they belong; comments that encoded unenforced invariants are replaced by enforcement. |
| 6 | LCOM | `SettleReservation` merges two identical classes; `ExecuteWithdrawal` sheds a responsibility; typed tokens end the `Deps`-bag/config mixing. |
| 7 | TASK.md | Closes §14 (consumer idempotency through the consumer, CI actually running the concurrency test), §15 (correlationId end-to-end, filter logging), §19 (`test/`). |
| 8 | YAGNI | `Brand` and `uuid` become load-bearing instead of dead; the dead methods, dead generic, dead `getById` and phantom `destination_address` go. **Watch item:** the `provide()` type helper must stay small — if it grows past ~30 lines it is itself a YAGNI violation. |
| 9 | KISS | **This is the plan's main risk.** Seven phases is a lot of motion for a repo that is already good. Mitigation and cut order: **Phases 0 and 0.5 are non-negotiable** — one makes verification real, the other fixes defects, and together they are the highest value-per-line work here. Phases 1–2 are what a CTO reads most closely. Phases 3–6 can be dropped in reverse order without leaving the codebase in a half-converted state; each ends green. |
| 10 | SOLID | ISP via narrower ports; OCP via derived unions and `isTerminal()`; DIP via typed tokens and `CodedError` replacing two hand-copied string registries. |
| 11 | DX | One runner, one packaging shape, one working test command, one place ports live, and a written charter — "add a use case" goes from seven ambiguous steps to a template. |
| 12 | Change amplification | New state: 9 files → ~3. New failure reason: 5 → 2. Second asset stays at 2. Fee stays expensive (it needs a ledger concept the wallet aggregate does not have) — out of scope per TASK.md §20, and worth naming in `DECISIONS.md` as a known modelling limit. |
| — | NestJS / DI | `apps/api` drops from ~190 lines of factory boilerplate to adapter bindings; DI wiring becomes compile-time checked; config becomes one validated object; `Clock` and `IdGenerator` re-enter DI. |

**Ordering note.** Phases 0 and 0.5 come first deliberately. Every later phase touches
transaction boundaries and SQL, and today nothing automated exercises either — doing the
safety net last would mean six phases of refactoring verified by reading. And fixing the
Phase 0.5 defects *before* restructuring keeps them attributable: a bug found and fixed in
its original form is a review finding, while the same bug rewritten mid-refactor is
indistinguishable from a regression you introduced.

---

## Appendix — the three shapes to get right

These are the pieces most likely to be implemented badly, so they are specified here rather
than left to the implementer.

**1. Typed identity.** `libs/platform/src/identity/`

```ts
export type Brand<V, N extends string> = V & { readonly __brand: N };
export type Uuid<N extends string> = Brand<string, N>;

export type UserId          = Uuid<'UserId'>;
export type WithdrawalId    = Uuid<'WithdrawalId'>;
export type ReservationId   = Uuid<'ReservationId'>;
export type EventId         = Uuid<'EventId'>;

export interface IdGenerator<N extends string> { next(): Uuid<N>; }

// `uuid@14` is already installed and currently unimported. Confirmed: it exports v7.
export const uuidGenerator = <N extends string>(): IdGenerator<N> => ({ next: () => v7() as Uuid<N> });
export const parseUuid = <N extends string>(raw: string, label: N): Uuid<N> => { … };
```

The single `parseUuid` replaces the three duplicated `assertIdentity` statics that today
throw two different error types for the same check. Because brands are structural, the two
generators in `RequestWithdrawal` stop being the same object under two names —
`IdGenerator<'WithdrawalId'>` and `IdGenerator<'EventId'>` are no longer interchangeable,
so the distinction the port already draws becomes real.

**2. Compile-checked DI.** `libs/platform/src/nest/`

```ts
declare const T: unique symbol;
export interface Token<V> extends InjectionToken { readonly [T]: V }
export const token = <V>(description: string): Token<V> => Symbol(description) as Token<V>;

type Values<D> = { [K in keyof D]: D[K] extends Token<infer V> ? V : never };

export function provide<V, const D extends readonly Token<unknown>[]>(
  target: Token<V>, deps: D, factory: (...args: Values<D>) => V,
): FactoryProvider { return { provide: target, inject: [...deps], useFactory: factory }; }
```

This is what removes the boilerplate rather than relocating it. Today
[withdrawal.module.ts:104-129](apps/api/src/composition/withdrawal.module.ts:104) correlates
a five-element `inject: []` array with five positional factory parameters **by hand** — if
the order drifts, nothing catches it until runtime. With `provide()`, a reorder is a type
error. Keep this helper under ~30 lines; past that it becomes the YAGNI it was meant to cure.

**3. Producer-owned event contract.** `libs/withdrawal/src/contracts/`

```ts
export const WITHDRAWAL_EXECUTION_REQUESTED = 'WithdrawalExecutionRequested' as const;

//  Deliberately NOT z.strictObject: an additive producer change must not dead-letter
//  100% of traffic on a consumer that has not been redeployed yet.
const schema = z.object({
  schemaVersion: z.literal(1),
  withdrawalId: uuidSchema, userId: uuidSchema,
  asset: z.string(), amount: z.string(),
});

export function withdrawalExecutionRequested(w: Withdrawal): IntegrationEventPayload<…>
export function parseWithdrawalExecutionRequested(raw: unknown): …
```

Both `RequestWithdrawal` and `RecoverStuckWithdrawals` build through the factory — today
they hand-construct the same payload at
[request-withdrawal.ts:118](libs/withdrawal/src/application/request-withdrawal/request-withdrawal.ts:118)
and [recover-stuck-withdrawals.ts:78](libs/withdrawal/src/application/recover-stuck-withdrawals/recover-stuck-withdrawals.ts:78)
with nothing checking that they agree, and only the first path is covered by
`event-contract.spec.ts`.
