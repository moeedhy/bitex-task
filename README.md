# Pooleno Withdrawal Backend

A production-conscious digital-asset withdrawal workflow implemented as an Nx-managed NestJS modular monolith. PostgreSQL is authoritative for balances, idempotency, transactions, outbox delivery, and consumer deduplication. Redis is only a fail-open rate-limit optimization.

## Projects

- `@bitex/platform` — exact `bigint` money, asset catalog, and stable technical ports.
- `@bitex/wallet` — Wallet domain with independent `WalletAccount` and `WalletReservation` aggregates.
- `@bitex/withdrawal` — Withdrawal domain, `WithdrawalAddress`, and vertical application slices.
- `@bitex/api` — Nest composition root plus PostgreSQL, Kafka, Redis, HTTP, and provider adapters.

## Run with Docker

```bash
cp .env.example .env
docker compose up --build
```

The seeded wallet is `user-123`, `USDT`, with `1000` available USDT (seeding is
enabled by `SEED_DEV_DATA=true`, which compose sets for local runs).

The application applies pending migrations on boot, so `docker compose up` works
against a fresh volume or one created by an earlier version.

## API

```bash
curl -i http://localhost:3000/withdrawals \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: 5b44de87-cd75-475f-9cb9-09533dd55971' \
  -d '{"userId":"user-123","asset":"USDT","amount":"100","destinationAddress":"TXYZ123456789"}'
```

```bash
curl http://localhost:3000/withdrawals/<withdrawal-id>
```

Reuse of the same key and same canonical payload returns the original logical response. Reuse with a different payload returns HTTP 409. Concurrent requests with the same key serialise on the idempotency row, so one creates the withdrawal and the other replays its result.

## Repository layout

```text
libs/platform        Money, Asset, and shared technical ports
libs/wallet          WalletAccount + WalletReservation aggregates and use cases
libs/withdrawal      Withdrawal aggregate, vertical slices, and its ports
apps/api/src/app             HTTP delivery
apps/api/src/composition     Nest modules (one per bounded context)
apps/api/src/infrastructure  adapters, grouped by the context that owns them
```

Tests are colocated with the code they cover (`*.spec.ts`) rather than kept in a
top-level `test/` directory, so a slice and its tests move together. PostgreSQL
integration tests live beside the adapters they exercise and are opt-in.

## Development and tests

```bash
pnpm install
pnpm nx run-many -t build lint typecheck
pnpm nx run-many -t test -- --runInBand
```

Real PostgreSQL concurrency tests are opt-in and never mocked:

```bash
docker compose up -d postgres
TEST_DATABASE_URL=postgresql://pooleno:pooleno@localhost:55433/pooleno_test \
  pnpm nx run api:test --runInBand
```

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
- Transactions bound `lock_timeout` and `statement_timeout`; the connection pool is bounded and shared deliberately.
- Provider calls happen outside database transactions and use `withdrawalId` as a durable fake-provider idempotency key.
- Money uses integer atomic units (`bigint`/PostgreSQL `BIGINT`), never JavaScript floating point.
- Migrations are applied by the application at startup under an advisory lock and recorded in `schema_migrations`, so an existing database is never left on an older schema.
- Nest modules mirror the bounded contexts; `WalletModule` exports use cases only and keeps its repositories private.
- Module boundaries are enforced by `@nx/enforce-module-boundaries`, so a Withdrawal-to-Wallet import fails `lint`.

## Assumptions and limitations

- Only USDT with six decimal places is supported.
- Authentication, fees, blockchain integration, reconciliation, and multi-provider routing are intentionally out of scope.
- Redis rate limiting fails open, so an outage reduces abuse protection but cannot affect balances.
- `userId` is taken from the request body and `GET /withdrawals/{id}` is unscoped; authentication is out of scope, but the ownership check belongs in the application layer and is a known omission.
- A withdrawal that can never resolve is re-published by the recovery worker on every cycle; bounding that needs an attempt counter.
- The fake provider stores its result in PostgreSQL to model provider-side idempotency. A real provider needs an idempotency key, lookup API, or reconciliation process.
- Kafka and the outbox provide at-least-once delivery, not exactly-once external effects.
- Actual implementation time: approximately 2 hours of AI-assisted implementation and verification.

See [architecture](docs/ARCHITECTURE.md), [domain model](docs/DOMAIN_MODEL.md), and [decisions](docs/DECISIONS.md).
