# Application Layer

## 1. Scope and precedence

This document describes the application layer of the wallet-withdrawal
workflow: the use cases, the ports they depend on, the transaction boundaries
they own, and the failure decisions they make.

It is written in the indicative because the layer is built. Where it and
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) disagree about the
application layer, this document wins; that document remains the reference for
the infrastructure and delivery concerns it covers. Requirements are cited as
`docs/TASK.md §N`.

The application layer expresses business use cases, orchestrates aggregates,
defines transaction boundaries, owns the inbound and outbound ports, and
decides what happens when something fails. It contains no SQL, no ORM or
`pg` types, no Kafka or Redis clients, no HTTP types, no transaction handles,
and no wallet or withdrawal arithmetic — those rules belong to the aggregates.

## 2. Shape

Three libraries, one composition root:

```text
@bitex/platform     Money, Asset, and stable technical ports
@bitex/wallet       WalletAccount + WalletReservation aggregates, wallet use cases
@bitex/withdrawal   Withdrawal aggregate, withdrawal use cases and ports
@bitex/api          Nest composition root and every adapter
```

Behaviour is organised as vertical slices, and dependencies cross boundaries in
one direction only:

```text
      HTTP            Kafka consumer        recovery timer
        |                   |                     |
        v                   v                     v
 RequestWithdrawal   ExecuteWithdrawal   RecoverStuckWithdrawals
 GetWithdrawal
        |
        v
   domain aggregates
        |
        v
   outbound ports  ->  PostgreSQL / Kafka / provider / wallet adapters
```

Use cases are concrete classes taking a single dependencies object. There is no
`UseCase<I, O>`, no `Repository<T>`, no command bus: direct invocation is
clearer at this size, and generic wrappers would hide exactly the semantics
hexagonal boundaries exist to make explicit.

Ports are TypeScript `interface`s. Nest modules — one per bounded context —
register every provider with `useFactory` against a class token and resolve the
interfaces inside those factories. The container therefore has a real dependency
graph while `libs/*` contains no NestJS import at all, and `WalletModule` can
export its use cases while keeping its repositories private.

## 3. Where logic lives

> The domain decides whether a state transition is legal.
> The application decides which operations take part in a workflow, and what
> happens when one of them fails.
> Infrastructure performs IO and enforces physical locking.

`WalletAccount.reserve()` deciding that a reservation would overdraw the wallet
is domain behaviour. Choosing to reserve funds *before* creating the Withdrawal,
inside one transaction, and to reject the request when the Idempotency-Key was
reused with a different payload, is application behaviour.

## 4. Transaction ownership

Every mutating operation is either a transaction **owner** or a **participant**,
and the answer is never ambiguous:

| Operation | Role |
| --- | --- |
| `RequestWithdrawal` | owner |
| `ExecuteWithdrawal` (prepare / settle) | owner of two short transactions |
| `RecoverStuckWithdrawals` | owner |
| `ReserveFunds`, `FinalizeReservation`, `ReleaseReservation` | participants |
| every repository, outbox, idempotency and inbox adapter | participant |

Application code expresses only *this must be atomic*:

```ts
return this.dependencies.transactionRunner.run(async () => { /* workflow */ });
```

`PostgresTransactionRunner` binds one `pg` client to an `AsyncLocalStorage`
scope. A nested `run` joins the active transaction instead of opening a second
one, which is what makes a wallet use case a participant when a withdrawal
workflow calls it. Participants obtain the bound client from infrastructure and
throw `MissingTransactionError` when there is none, so a forgotten boundary
fails loudly rather than silently losing its row lock.

No transaction object ever appears in an application signature.

## 5. RequestWithdrawal

One transaction (`docs/TASK.md §3.1`, `§11`):

```text
BEGIN
  claim the Idempotency-Key
    replay   -> return the stored result
    conflict -> reject
  reserve wallet funds        (locks the wallet row)
  create and persist the Withdrawal
  append WithdrawalExecutionRequested to the outbox
  store the response for future replays
COMMIT
```

### 5.1 Idempotency has three outcomes, and they are return values

```ts
export type IdempotencyClaim =
  | { kind: 'CLAIMED' }
  | { kind: 'REPLAY'; result: RequestWithdrawalResult }
  | { kind: 'CONFLICT' };
```

The use case switches exhaustively and calls `assertNever` in the default
branch, so adding a fourth outcome becomes a compile error rather than a
silently ignored case.

`CONFLICT` is a returned outcome rather than an adapter-thrown exception, and
`IdempotencyKeyConflictError` is defined in the application layer. This matters:
if the adapter threw its own error type, then whichever storage happened to
detect the collision would define the API's 409 behaviour, and swapping that
storage would silently change the contract. It also means the rejection path is
unit-testable without a database.

### 5.2 Concurrency on the same key

The claim is `INSERT ... ON CONFLICT (operation, idempotency_key) DO NOTHING`
followed, when the insert finds an existing row, by `SELECT ... FOR UPDATE`.

A concurrent duplicate blocks on the unique index until the first transaction
resolves, then reads its committed outcome: one withdrawal, one replay
(`docs/TASK.md §9`). The cost of that serialisation is that a duplicate holds a
pooled connection while it waits — which is why lock waits are bounded (§11).

Because the claim and the completion share one transaction, an abandoned claim
rolls back with the workflow. Two consequences, both intended:

- a request that fails on a business rule (insufficient balance) leaves no
  record, so the key is reusable — the caller may legitimately retry with a
  corrected amount;
- `IN_PROGRESS` is never observable after commit. The column and its check
  constraint still describe the intra-transaction state honestly, but any
  *committed* record that is not `COMPLETED` is a data-integrity alarm, not a
  business outcome, and the adapter raises `CorruptIdempotencyRecordError`
  rather than mapping it to a 4xx.

### 5.3 The fingerprint belongs to the workflow

`createRequestFingerprint` lives in the application layer, not in the
controller, and the command carries no `fingerprint` field for a caller to
supply.

The rule is workflow policy: every entry point must produce identical output
for identical intent, and a driving adapter cannot be trusted to reproduce it.
It is computed from *parsed* values, so `100`, `100.0` and `100.000000` collapse
to one atomic amount and the destination is normalised by the same
`WithdrawalAddress` value object the aggregate stores — closing a real trap,
where fingerprinting a raw string before normalisation would let a future
normalisation change turn one retry into two withdrawals.

Fields are length-prefixed rather than delimiter-joined, because `userId` and
the destination are caller-supplied and no separator is guaranteed absent from
them. The result is a readable string rather than a digest, so a production
conflict can be diagnosed by reading the row. Volatile data — correlation ids,
timestamps, headers — is excluded by construction.

## 6. ExecuteWithdrawal

Kafka is only the transport. The workflow runs in three phases so that no
database transaction is ever held across the provider call
(`docs/TASK.md §3.2`, `§10`):

```text
transaction 1   already processed? -> stop
                lock the Withdrawal
                PENDING -> PROCESSING (PROCESSING resumes)
                terminal -> record the event and stop
COMMIT

                provider.execute(...)      <- no transaction held

transaction 2   already processed? -> stop
                lock the Withdrawal
                SUCCESS -> complete + finalize the reservation
                FAILED  -> fail + release the reservation
                record the processed event
COMMIT
```

Settlement and the processed-event record commit together, which is what stops
a duplicate delivery from settling twice (`docs/TASK.md §10`). The event is
recorded only *after* the outcome is durable — never when work merely started.

### 6.1 Provider rejection is not provider failure

A `FAILED` result is a business outcome: the withdrawal fails and the
reservation is released. A thrown error is *uncertainty* — the transfer may
have happened — so the workflow raises
`WithdrawalExecutionUnresolvedError`, leaves the Withdrawal `PROCESSING` and the
reservation `ACTIVE`, and lets redelivery re-drive the provider.

This is safe only because the provider is idempotent on `withdrawalId`. That is
a hard architectural precondition, not an optimisation: a provider without an
idempotency key, a lookup API, or a reconciliation process would make this
design double-spend.

### 6.2 Failures that cannot succeed must not block the partition

`eachMessage` rethrowing forever parks a Kafka partition on one bad record and
strands every other withdrawal behind it. The consumer therefore classifies:

- **unparseable** (bad JSON, contract mismatch) → dead-letter immediately;
- **non-retryable** (`WITHDRAWAL_NOT_FOUND`, illegal transitions, missing
  wallet or reservation) → dead-letter immediately, no retry;
- **anything else** → up to 5 attempts with linear backoff, then dead-letter.

Dead-lettering publishes the original message to `<topic>.dlq` with the reason
and error code in headers, and commits the offset. If the dead-letter publish
itself fails it is logged and swallowed — losing the parked copy must not
resurrect the poison message, because the money is still recoverable by §7.

## 7. RecoverStuckWithdrawals

At-least-once delivery closes every crash window in §6 *while the message still
exists*. Messages stop existing: retention expires, offsets get reset, or §6.2
dead-letters one to unblock a partition. Nothing would then re-drive the
withdrawal, and the caller's funds would stay reserved indefinitely.

A timer scans for withdrawals `PROCESSING` longer than the timeout (15 minutes
by default) and appends a fresh `WithdrawalExecutionRequested` to the outbox for
each, inside one transaction.

The event id is deliberately new. Reusing the original would let
`processed_events` suppress precisely the retry that is wanted. Safety comes
from the two guards that already exist: `ExecuteWithdrawal` refuses to
re-settle a terminal Withdrawal, and the provider is idempotent on
`withdrawalId`.

Trade-off, accepted knowingly: a withdrawal that can never resolve is
re-published every cycle. Bounding the attempts would need an attempt counter on
the withdrawal; for a financial operation that must eventually resolve, an
unbounded retry with a long interval and a loud log is the safer default.

## 8. GetWithdrawal

A read-only slice over a query port returning a `WithdrawalView`. It does not
reconstitute the aggregate, and it does not open a transaction — lightweight
CQRS without a CQRS framework. Infrastructure is free to answer it with
optimised SQL.

## 9. Wallet and Withdrawal collaborate through consumer-owned ports

Withdrawal owns the contracts it needs and never imports wallet code
(`docs/TASK.md §4.1`):

```ts
interface WalletReservationPort {
  reserve(input: { withdrawalId: string; userId: string; amount: Money }):
    Promise<{ reservationId: string }>;
}

interface WalletSettlementPort {
  finalize(reservationId: string): Promise<void>;
  release(reservationId: string): Promise<void>;
}
```

Two narrow capabilities rather than one `WalletPort`, adapted at the composition
root to the wallet use cases. Neither port exposes an aggregate, a repository,
a lock, or a row.

This is enforced, not merely documented: every project carries `type:` and
`scope:` tags and `@nx/enforce-module-boundaries` rejects a withdrawal → wallet
import at lint time.

Note that `reserve` takes `Money` and no separate `Asset`. `Money` carries its
own asset, so a command whose asset disagrees with its amount cannot be
represented, and the wallet that gets locked cannot differ from the money that
gets reserved.

## 10. Errors

| Kind | Examples | Owner |
| --- | --- | --- |
| Domain | `InsufficientAvailableBalanceError`, `InvalidWithdrawalTransitionError` | aggregate |
| Application | `IdempotencyKeyConflictError`, `WithdrawalNotFoundError`, `WithdrawalExecutionUnresolvedError` | use case |
| Infrastructure | `MissingTransactionError`, `CorruptIdempotencyRecordError`, driver failures | adapter |

No error carries an HTTP status. `ApiExceptionFilter` maps a stable `code` to a
status at the edge, and anything unmapped is a 500 with a generic message.
Infrastructure failures are not converted into business outcomes.

## 11. Concurrency and lock bounds

Wallet mutation locks the row with `SELECT ... FOR UPDATE`
(`docs/TASK.md §6`); the reservation is a separately locked aggregate.

Every transaction sets `lock_timeout` (3s) and `statement_timeout` (10s) via
transaction-local `set_config`. Without a bound, a burst of duplicates on one
key parks pooled connections indefinitely, and since the HTTP path, the outbox
publisher, the recovery worker and the read model share one bounded pool, that
starves event delivery. Failing a request beats stalling the pipeline.

## 12. Deliberately outside this layer

- **Rate limiting** stays in the HTTP adapter. It protects the endpoint, not
  the invariant, and it fails open — including at startup, where the Redis
  connection is deliberately not awaited, so an outage cannot stop the service
  from accepting withdrawals (`docs/TASK.md §8`).
- **Schema migration** is infrastructure, applied at startup before any module
  queries. The application layer never sees it.
- **Authorization and ownership.** `userId` arrives in the request body and
  `GET /withdrawals/{id}` is unscoped. Authentication is out of scope
  (`docs/TASK.md §20`), but the check belongs in the application layer as a
  workflow prerequisite, not in the controller. This is an omission, not a
  design position.

## 13. Testing

Application tests instantiate use cases directly with hand-written doubles: no
Nest container, no database, no Kafka. What genuinely needs a database is tested
against a real one and never mocked (`docs/TASK.md §14`).

| Slice | Covered |
| --- | --- |
| `RequestWithdrawal` | orchestration and ordering, derived fingerprint, replay, key conflict, wallet rejection propagation, one transaction |
| `createRequestFingerprint` | formatting-insensitivity, key-independence, per-field separation, field-boundary spoofing |
| `ExecuteWithdrawal` | success, declared failure, unresolved provider call, duplicate event |
| `RecoverStuckWithdrawals` | re-publish, timeout threshold, fresh event ids, empty scan |
| consumer | parse failure, contract mismatch, retry-then-succeed, retries exhausted, non-retryable |
| composition | every use case resolves, providers are singletons, one shared transaction runner, controller receives use cases |
| PostgreSQL (opt-in) | concurrent 80+80 from 100, concurrent same key, key reuse with a different payload, finalize-once, release-on-failure, recovery re-publish |

## 14. Definition of done

Each of these is a command, not a judgement call:

```bash
pnpm nx run-many -t build lint typecheck   # boundaries, types, strictness
pnpm nx run-many -t test --runInBand       # unit + slice tests

docker compose up -d postgres
TEST_DATABASE_URL=postgresql://pooleno:pooleno@localhost:55433/pooleno_test \
  pnpm nx run api:test --runInBand         # real concurrency and transactions
```

`lint` enforces the dependency direction and module isolation of §9, and
`composition.spec.ts` compiles the real container so a wiring mistake fails a
test rather than a deployment.
`typecheck` runs under `strict` plus `noUncheckedIndexedAccess`,
`noImplicitReturns`, `noImplicitOverride` and `noFallthroughCasesInSwitch`, so
an unhandled union member or an unchecked row access fails the build.

Note that `tsc --build` is incremental: a stale `.tsbuildinfo` can mask errors
after a compiler-option change. Use `--force` when changing `tsconfig.base.json`.

## 15. What I would change next

- **Ownership checks** (§12) are the largest correctness gap that is not a
  challenge constraint.
- ~~**Outbox growth**: published rows are never pruned.~~ Implemented —
  `OutboxPublisher.pruneIfDue` removes published rows past `OUTBOX_RETENTION_MS`
  on its own cadence. `processed_events` and `idempotency_records` still have no
  retention, and should get the same treatment.
- **Recovery attempt limits** (§7) once there is somewhere to record them.
- **Dead-letter reprocessing**: a parked message currently needs an operator;
  the withdrawal itself recovers, the audit trail does not.
- **Separate pools** for the publisher and the request path, so the two cannot
  contend at all (§11 bounds the damage rather than removing it).
