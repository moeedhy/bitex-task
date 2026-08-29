# Pooleno Withdrawal Backend

A production-conscious digital-asset withdrawal workflow implemented as an Nx-managed NestJS modular monolith. PostgreSQL is authoritative for balances, idempotency, transactions, outbox delivery, and consumer deduplication. Redis is only a fail-open rate-limit optimization.

## Projects

- `@bitex/platform` — exact `bigint` money, asset catalog, branded UUID identity,
  the `CodedError` base and the integration-event envelope.
- `@bitex/wallet` — Wallet domain with independent `WalletAccount` and
  `WalletReservation` aggregates.
- `@bitex/withdrawal` — Withdrawal domain with domain events, vertical
  application slices, and the published integration contract.
- `@bitex/api` — adapter bindings plus PostgreSQL, Kafka, Redis, HTTP and
  provider adapters. It holds no business logic; each context wires itself.

## Run with Docker

```bash
cp .env.example .env
docker compose up --build
```

The seeded wallet belongs to user `00000000-0000-7000-8000-000000000001` and
holds `1000` available `USDT` (seeding is enabled by `SEED_DEV_DATA=true`, which
compose sets for local runs).

Every identifier in this service is a UUID, including `userId` — see
`docs/DECISIONS.md` §27 for why, and for the one-file change that reverts it.

The application applies pending migrations on boot, so `docker compose up` works
against a fresh volume or one created by an earlier version.

## API

```bash
curl -i http://localhost:3000/withdrawals \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: 5b44de87-cd75-475f-9cb9-09533dd55971' \
  -d '{"userId":"00000000-0000-7000-8000-000000000001","asset":"USDT","amount":"100","destinationAddress":"TXYZ123456789"}'
```

```bash
curl http://localhost:3000/withdrawals/<withdrawal-id>
```

Reuse of the same key and same canonical payload returns the original logical response. Reuse with a different payload returns HTTP 409. Concurrent requests with the same key serialise on the idempotency row, so one creates the withdrawal and the other replays its result.

Every failure answers with the same envelope — `{ statusCode, errorCode, message }`.
The status for each `errorCode` is a `Record<ApiErrorCode, HttpStatus>`, so a
domain error that nobody mapped is a compile error rather than a 500.

Pass `x-correlation-id` and it is echoed back, stored on the outbox row,
published as a Kafka header and re-opened by the consumer, so one id links the
request to the settlement that answered it.

## Repository layout

```text
libs/platform        Money, Asset, branded identity, CodedError, event envelope
libs/wallet          WalletAccount + WalletReservation aggregates and use cases
libs/withdrawal      Withdrawal aggregate, vertical slices, ports, and the
                     published integration contract
libs/*/src/nest      each context's own Nest module -- the only NestJS imports

apps/api/src/http            controller, DTOs, exception filter, rate-limit guard
apps/api/src/config          one zod-validated AppConfig
apps/api/src/modules         adapter bindings for the contexts' tokens
apps/api/src/observability   correlation-id context and middleware
apps/api/src/adapters        adapters, grouped by the context that owns them
```

Each library ships its own Nest module behind a `./nest` subpath export, so a
bounded context owns its composition. `apps/api` chooses adapters and binds them
to the contexts' tokens; it contains no business logic.

`docs/CONVENTIONS.md` is the charter these follow — naming, ports, errors,
contracts, DI — and says which rules are enforced by the build rather than by
review.

**On the deliverables layout.** The brief sketches a flat `src/` + `test/` tree.
This is an Nx monorepo, so neither exists at the root: the code lives in `apps/`
and `libs/`, and tests are colocated with what they cover (`*.spec.ts`) so a
slice and its tests move together. PostgreSQL integration tests sit beside the
adapters they exercise. Adding a top-level `test/` while `src/` does not exist
would be half a layout rather than a structure.

## Development and tests

```bash
pnpm install
pnpm nx run-many -t build lint typecheck
pnpm nx run-many -t test -- --runInBand
```

Every project runs on Jest; there is no second test runner.

The PostgreSQL tests are never mocked. They self-skip without `TEST_DATABASE_URL`,
so run them with a database to exercise the real transactions, locks and
constraints:

```bash
docker compose up -d postgres
```

```bash
TEST_DATABASE_URL=postgresql://pooleno:pooleno@localhost:55433/pooleno_test \
  pnpm nx run @bitex/api:test --runInBand
```

CI always sets `TEST_DATABASE_URL` (see `.github/workflows/ci.yml`), so the
concurrency requirement is verified on every push rather than only when someone
remembers to export it locally.

## Correctness model

- Wallet mutations load `wallets` with `SELECT ... FOR UPDATE`.
- Reservation lifecycle uses a separately locked `WalletReservation` aggregate; Wallet never loads reservation history.
- Wallet reservation, Withdrawal insert, Outbox insert, and idempotency completion share one PostgreSQL transaction.
- Repository mutations fail fast without a transaction-bound client.
- Outbox rows are leased using `FOR UPDATE SKIP LOCKED`; duplicate Kafka delivery remains expected.
- The consumer records `processed_events` in the same transaction as terminal Withdrawal and Wallet settlement.
- Idempotency returns `CLAIMED`, `REPLAY` or `CONFLICT`; the request fingerprint is derived inside the workflow from parsed values, never supplied by the caller.
- Messages that cannot succeed are dead-lettered to `<topic>.dlq` so one bad record cannot park a Kafka partition.
- Withdrawals left `PROCESSING` past a timeout are re-driven by a recovery worker, so a lost or dead-lettered message cannot strand reserved funds.
- Transactions opened through `PostgresTransactionRunner` bound `lock_timeout` and `statement_timeout`; the connection pool is bounded and shared deliberately.
- Every aggregate write asserts it changed exactly one row. A no-op `UPDATE` aborts the transaction instead of committing a reservation whose wallet was never debited.
- Locks are taken in one order everywhere — wallet → reservation on the reserve path, reservation → wallet on the settle path — and that hierarchy is documented rather than accidental.
- Provider calls happen outside database transactions and use `withdrawalId` as a durable fake-provider idempotency key.
- Money uses integer atomic units (`bigint`/PostgreSQL `BIGINT`), never JavaScript floating point.
- Migrations are applied by the application at startup under an advisory lock and recorded in `schema_migrations`, so an existing database is never left on an older schema.
- Each context ships its own Nest module and exports use cases only, keeping its repositories private. `@nestjs/common` appears under `libs/*/src/nest/` and nowhere else, so the domain and application layers import no framework.
- DI wiring is type-checked: tokens carry the type they resolve to, and a factory whose parameters disagree with its `inject` list is a compile error rather than a runtime one.
- A domain error with no HTTP status mapping is a compile error, not a 500.
- Module boundaries are enforced by `@nx/enforce-module-boundaries`, so a Withdrawal-to-Wallet import fails `lint` — including through a `./nest` subpath.
- Invariant "a failed withdrawal releases its reservation" is a domain event the aggregate emits, handled exhaustively, so a new terminal state cannot be added without deciding what happens to the reserved funds.

## Assumptions and limitations

- Only USDT with six decimal places is supported.
- Authentication, fees, blockchain integration, reconciliation, and multi-provider routing are intentionally out of scope.
- Redis rate limiting fails open, so an outage reduces abuse protection but cannot affect balances.
- `userId` is taken from the request body and `GET /withdrawals/{id}` is unscoped; authentication is out of scope, but the ownership check belongs in the application layer and is a known omission.
- A withdrawal that can never resolve is retried once per timeout window rather than on every cycle — recovery claims rows with `FOR UPDATE SKIP LOCKED` and re-stamps `updated_at` — but it is still retried indefinitely. Bounding that needs an attempt counter, and a column to hold it.
- `processed_events` and `idempotency_records` have no retention policy; `outbox_events` does.
- The fake provider stores its result in PostgreSQL to model provider-side idempotency. A real provider needs an idempotency key, lookup API, or reconciliation process.
- Kafka and the outbox provide at-least-once delivery, not exactly-once external effects.
- Actual implementation time: approximately 2 hours of AI-assisted implementation and verification, followed by a structured architecture review and refactor (`docs/plans/REFACTOR_PLAN.md`).

See [architecture](docs/ARCHITECTURE.md), [domain model](docs/DOMAIN_MODEL.md),
[conventions](docs/CONVENTIONS.md), and [decisions](docs/DECISIONS.md).
