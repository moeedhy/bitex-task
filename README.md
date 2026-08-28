# Pooleno Withdrawal Backend

A production-conscious digital-asset withdrawal workflow implemented as an Nx-managed NestJS modular monolith. PostgreSQL is authoritative for balances, idempotency, transactions, outbox delivery, and consumer deduplication. Redis is only a fail-open rate-limit optimization.

## Projects

- `@bitex/platform` — exact `bigint` money, asset catalog, and stable technical ports.
- `@bitex/wallet` — independent Wallet bounded context and `WalletAccount` aggregate.
- `@bitex/withdrawal` — Withdrawal bounded context and vertical application slices.
- `@bitex/api` — Nest composition root plus PostgreSQL, Kafka, Redis, HTTP, and provider adapters.

## Run with Docker

```bash
cp .env.example .env
docker compose up --build
```

The seeded wallet is `user-123`, `USDT`, with `1000` available USDT.

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

Reuse of the same key and same canonical payload returns the original logical response. Reuse with a different payload returns HTTP 409.

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
- Wallet reservation, Withdrawal insert, Outbox insert, and idempotency completion share one PostgreSQL transaction.
- Repository mutations fail fast without a transaction-bound client.
- Outbox rows are leased using `FOR UPDATE SKIP LOCKED`; duplicate Kafka delivery remains expected.
- The consumer records `processed_events` in the same transaction as terminal Withdrawal and Wallet settlement.
- Provider calls happen outside database transactions and use `withdrawalId` as a durable fake-provider idempotency key.
- Money uses integer atomic units (`bigint`/PostgreSQL `BIGINT`), never JavaScript floating point.

## Assumptions and limitations

- Only USDT with six decimal places is supported.
- Authentication, fees, blockchain integration, reconciliation, and multi-provider routing are intentionally out of scope.
- Redis rate limiting fails open, so an outage reduces abuse protection but cannot affect balances.
- The fake provider stores its result in PostgreSQL to model provider-side idempotency. A real provider needs an idempotency key, lookup API, or reconciliation process.
- Kafka and the outbox provide at-least-once delivery, not exactly-once external effects.
- Actual implementation time: approximately 2 hours of AI-assisted implementation and verification.

See [architecture](docs/ARCHITECTURE.md), [domain model](docs/DOMAIN_MODEL.md), and [decisions](docs/DECISIONS.md).
