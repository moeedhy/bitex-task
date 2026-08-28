# Implementation Plan — Pooleno Withdrawal Backend

You are implementing the Pooleno Senior Node.js Backend Challenge.

Build a small, production-conscious digital-asset withdrawal backend using:

- Node.js
- TypeScript
- NestJS
- PostgreSQL
- Redis
- Kafka

The implementation must prioritize correctness, DDD, concurrency safety, idempotency, transaction design, and testability over infrastructure complexity.

## 1. Architectural principles

Use:

- Modular Monolith
- Domain-Driven Design
- Hexagonal Architecture / Ports and Adapters
- Vertical Slice Architecture for application use cases
- PostgreSQL as the source of truth
- Transactional Outbox
- Idempotent Kafka consumers
- AsyncLocalStorage / `nestjs-cls` only for infrastructure-level transaction propagation

Do not introduce:

- microservices
- Saga for wallet reservation
- distributed transactions
- RabbitMQ
- MongoDB
- event sourcing
- generic CRUD repositories
- generic business service abstractions
- infrastructure dependencies in the domain layer

## 2. Strategic domain boundary

Do not assume Wallet and Withdrawal are separate Bounded Contexts.

For this challenge model them as separate modules and aggregate boundaries inside the same withdrawal/funds processing context:

```text
Withdrawal Processing Context
│
├── Wallet Module
│   └── WalletAccount Aggregate
│
└── Withdrawal Module
    └── Withdrawal Aggregate
```

The reason is that requesting a withdrawal requires strong atomic consistency across Wallet reservation and Withdrawal creation.

Keep the architecture structured so Wallet could later become an independent bounded context/service, but do not sacrifice today's ACID guarantee for hypothetical distribution.

## 3. Aggregate boundaries

### WalletAccount Aggregate

Responsibilities:

- total balance
- reserved balance
- available balance
- reservations
- reserve funds
- release reservation
- finalize reservation

Core invariants:

- withdrawal/reservation amount > 0
- available balance never becomes negative
- reserved balance never exceeds total balance
- a Withdrawal cannot reserve funds twice
- finalized reservation cannot be released
- released reservation cannot be finalized twice

Domain behavior should resemble:

```ts
wallet.reserve(withdrawalId, amount);
wallet.finalizeReservation(reservationId);
wallet.releaseReservation(reservationId);
```

Do not put transaction or ORM parameters inside domain methods.

### Withdrawal Aggregate

Responsibilities:

- withdrawal identity
- user
- asset
- amount
- destination
- reservation reference
- execution status
- provider transaction reference
- lifecycle transitions

Prefer a state model similar to:

```text
FUNDS_RESERVED
      |
      v
PROCESSING
   /       \
  v         v
COMPLETED  FAILED
```

If API compatibility requires `PENDING`, map the internal state to the external response rather than weakening the internal model.

Invalid transitions must throw domain errors.

Examples:

```text
COMPLETED -> PROCESSING    invalid
FAILED -> COMPLETED        invalid
COMPLETED -> FAILED        invalid
```

## 4. Shared domain concepts

Create only genuinely shared domain concepts:

```text
shared/domain/
  Money.ts
  Asset.ts
  DomainError.ts
  IntegrationEvent.ts
```

Use integer atomic/minor units or a safe Decimal implementation.

Never use JavaScript floating-point arithmetic for money.

If using integer units, prefer `bigint` in the domain and a compatible PostgreSQL representation.

## 5. Application architecture — vertical slices

Organize application code primarily around business use cases.

### Withdrawal slices

```text
withdrawal/application/

  request-withdrawal/
    RequestWithdrawal.ts
    RequestWithdrawalCommand.ts
    RequestWithdrawalResult.ts
    ports/
      WalletReservationPort.ts
      WithdrawalIdempotencyPort.ts

  execute-withdrawal/
    ExecuteWithdrawal.ts
    ports/
      WalletSettlementPort.ts
      WithdrawalProvider.ts
      ProcessedEventPort.ts

  get-withdrawal/
    GetWithdrawal.ts
    ports/
      WithdrawalQueryPort.ts

  ports/
    WithdrawalRepository.ts
```

### Wallet slices

```text
wallet/application/

  reserve-funds/
    ReserveFundsService.ts

  finalize-reservation/
    FinalizeReservationService.ts

  release-reservation/
    ReleaseReservationService.ts

  ports/
    WalletRepository.ts
```

Keep domain models shared within their module instead of duplicating them per vertical slice.

## 6. Ports — ownership rules

Use this rule:

> Genericize stable technical capabilities. Do not genericize business capabilities.

### Shared generic ports

Place under:

```text
shared/application/ports/
```

Define:

```ts
interface TransactionRunner {
  run<T>(operation: () => Promise<T>): Promise<T>;
}
```

Also define if useful:

```ts
interface Clock {
  now(): Date;
}

interface IdGenerator {
  next(): string;
}

interface Outbox {
  append(event: IntegrationEvent): Promise<void>;
}
```

These are stable technical capabilities and may be reused.

### Do NOT create

Do not create:

```ts
Repository<T>
CrudRepository<T>
BaseRepository<T>
BusinessService<T>
GenericUseCase<T>
GenericEventBus<T>
```

Repositories must describe aggregate-specific persistence needs.

Example:

```ts
interface WalletRepository {
  getForUpdate(
    userId: UserId,
    asset: Asset,
  ): Promise<WalletAccount>;

  save(wallet: WalletAccount): Promise<void>;
}
```

Example:

```ts
interface WithdrawalRepository {
  add(withdrawal: Withdrawal): Promise<void>;

  getById(
    id: WithdrawalId,
  ): Promise<Withdrawal | null>;

  getForUpdate(
    id: WithdrawalId,
  ): Promise<Withdrawal>;
}
```

### Consumer-owned business ports

`RequestWithdrawal` must NOT depend directly on `WalletRepository`.

Define a consumer-owned port:

```ts
interface WalletReservationPort {
  reserve(input: {
    withdrawalId: WithdrawalId;
    userId: UserId;
    asset: Asset;
    amount: Money;
  }): Promise<{
    reservationId: ReservationId;
  }>;
}
```

Place it in:

```text
withdrawal/application/request-withdrawal/ports/
```

Implement it with an internal Wallet adapter.

Similarly, `ExecuteWithdrawal` should depend on:

```ts
interface WalletSettlementPort {
  finalize(
    reservationId: ReservationId,
  ): Promise<void>;

  release(
    reservationId: ReservationId,
  ): Promise<void>;
}
```

Do not expose one large `WalletPort` containing unrelated capabilities.

Follow Interface Segregation.

## 7. Transaction architecture

`RequestWithdrawal` owns the business transaction boundary.

Application code must depend only on:

```ts
TransactionRunner
```

Example:

```ts
return transactionRunner.run(async () => {
  // idempotency
  // wallet reservation
  // withdrawal creation
  // outbox
});
```

Do NOT:

- inject `EntityManager` into application services
- pass Prisma transaction clients through method arguments
- pass TypeORM `QueryRunner`
- use NestJS/CLS decorators directly inside domain/application code

## 8. AsyncLocalStorage / nestjs-cls

Use `nestjs-cls` or AsyncLocalStorage only as an infrastructure implementation detail.

Structure:

```text
Application
    |
    v
TransactionRunner
    |
    v
ClsTransactionRunner
    |
    v
nestjs-cls TransactionHost
    |
    v
AsyncLocalStorage
    |
    v
ORM transaction
```

Implement:

```ts
@Injectable()
class ClsTransactionRunner
  implements TransactionRunner {
  async run<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.transactionHost.withTransaction(
      Propagation.Required,
      operation,
    );
  }
}
```

All PostgreSQL repositories participating in the operation must use the current transaction-bound manager/client from the transaction host.

Do not accidentally use a normal TypeORM repository or normal Prisma client inside an active transaction.

## 9. Fail-fast transaction protection

Financial mutation repositories must fail if called without an active transaction when a transaction is required.

For example:

```ts
private assertTransaction(): void {
  if (!this.transactionHost.isTransactionActive()) {
    throw new MissingTransactionError();
  }
}
```

Use this in operations such as:

```ts
getForUpdate()
saveReservation()
finalizeReservation()
releaseReservation()
```

This prevents silent loss of locking guarantees.

Add an integration test proving this behavior.

## 10. RequestWithdrawal transaction

Implement this exact conceptual flow.

### Before the transaction

Perform only pure validation/parsing:

- parse request
- parse amount safely
- validate amount format
- validate destination format
- calculate canonical request fingerprint

Do not read or mutate financial state here.

### Inside one PostgreSQL transaction

```text
1. Claim Idempotency-Key
2. Detect replay or conflicting payload
3. Generate WithdrawalId
4. Reserve wallet funds
5. Create Withdrawal aggregate
6. Persist Withdrawal
7. Persist Outbox event
8. Persist idempotency response
9. Commit
```

Pseudo-code:

```ts
async execute(
  command: RequestWithdrawalCommand,
): Promise<RequestWithdrawalResult> {

  return this.transactionRunner.run(async () => {

    const idempotency =
      await this.idempotency.claim({
        operation: 'REQUEST_WITHDRAWAL',
        key: command.idempotencyKey,
        fingerprint: command.fingerprint,
      });

    if (idempotency.isReplay) {
      return idempotency.result;
    }

    const withdrawalId =
      WithdrawalId.create(this.idGenerator.next());

    const reservation =
      await this.walletReservation.reserve({
        withdrawalId,
        userId: command.userId,
        asset: command.asset,
        amount: command.amount,
      });

    const withdrawal =
      Withdrawal.request({
        id: withdrawalId,
        userId: command.userId,
        asset: command.asset,
        amount: command.amount,
        destination: command.destination,
        reservationId:
          reservation.reservationId,
      });

    await this.withdrawals.add(withdrawal);

    await this.outbox.append(
      WithdrawalExecutionRequested.create({
        withdrawal,
        occurredAt: this.clock.now(),
      }),
    );

    const result =
      RequestWithdrawalResult.from(withdrawal);

    await this.idempotency.complete(
      command.idempotencyKey,
      result,
    );

    return result;
  });
}
```

## 11. Idempotency design

PostgreSQL is authoritative.

Redis must NOT provide the durable idempotency guarantee.

Create an idempotency table approximately containing:

```text
operation
idempotency_key
request_fingerprint
status
withdrawal_id
response_payload
created_at
completed_at
```

Add:

```sql
UNIQUE(operation, idempotency_key)
```

Concurrent identical requests must result in exactly:

- one Withdrawal
- one Wallet reservation
- one Outbox event

Use an atomic claim strategy such as:

```sql
INSERT ...
ON CONFLICT DO NOTHING
```

If the key already exists:

- same fingerprint + completed result → return original logical response
- same fingerprint + in progress → resolve safely according to transaction behavior
- different fingerprint → return conflict, preferably HTTP 409

Do not lock the wallet before resolving idempotency if avoidable.

## 12. Wallet concurrency

Use PostgreSQL row-level locking.

Preferred implementation:

```sql
SELECT *
FROM wallets
WHERE user_id = $1
  AND asset = $2
FOR UPDATE;
```

Then:

```ts
const wallet =
  await walletRepository.getForUpdate(
    userId,
    asset,
  );

wallet.reserve(
  withdrawalId,
  amount,
);

await walletRepository.save(wallet);
```

Use a short transaction.

Do not use:

- in-memory mutexes
- Redis as the financial lock
- read-then-update without locking

The required test:

```text
Wallet = 100 USDT

Concurrent:
A = withdraw 80
B = withdraw 80

Expected:
one succeeds
one fails
reserved never becomes 160
```

## 13. Database constraints

Use domain invariants plus DB constraints.

Examples:

```sql
CHECK (balance >= 0)
CHECK (reserved_balance >= 0)
CHECK (reserved_balance <= balance)
```

Wallet identity:

```sql
UNIQUE(user_id, asset)
```

Reservation:

```sql
UNIQUE(withdrawal_id)
```

Idempotency:

```sql
UNIQUE(operation, idempotency_key)
```

Processed Kafka events:

```sql
UNIQUE(event_id)
```

Use constraints as defense in depth, not as replacements for domain behavior.

## 14. Reservation identity

Create the `WithdrawalId` before reserving funds.

Pass it into Wallet:

```ts
wallet.reserve(
  withdrawalId,
  amount,
);
```

Persist `withdrawal_id` on the reservation and add a uniqueness constraint.

This prevents duplicate reservation for the same Withdrawal even if application-level idempotency fails.

## 15. Outbox

Never publish Kafka directly inside the request transaction.

Inside the transaction:

```text
Wallet mutation
Withdrawal creation
Outbox INSERT
Idempotency result
COMMIT
```

After commit:

```text
OutboxPublisher
    |
    v
Kafka
```

The application writes an integration event through:

```ts
interface Outbox {
  append(
    event: IntegrationEvent,
  ): Promise<void>;
}
```

Do not expose `KafkaProducer` to application code.

## 16. Outbox publisher

Implement a background publisher that:

- fetches pending records
- safely claims batches
- supports horizontal publisher instances
- publishes to Kafka
- marks successful records
- retries failures

Prefer PostgreSQL claiming with:

```sql
FOR UPDATE SKIP LOCKED
```

or an explicit leasing strategy.

Assume this crash window exists:

```text
Kafka publish succeeds
process crashes
before published_at update
```

Therefore duplicate Kafka messages are expected.

Consumers must be idempotent.

## 17. ExecuteWithdrawal

The Kafka consumer is an inbound adapter.

It should call an application slice:

```text
Kafka Consumer
      |
      v
ExecuteWithdrawal
```

Do not put business logic inside the Kafka handler.

The Kafka adapter should mainly:

- deserialize
- validate envelope
- construct command
- call `ExecuteWithdrawal`

## 18. Provider call and transaction boundaries

Never hold a PostgreSQL transaction open while calling the fake external provider.

Bad:

```text
BEGIN
lock wallet
call provider for 2 seconds
update state
COMMIT
```

Correct:

### Phase 1

Short transaction:

```text
claim execution
transition Withdrawal to PROCESSING if appropriate
commit
```

### Phase 2

Outside transaction:

```text
call provider
```

### Phase 3

Short transaction:

```text
apply provider result
settle wallet reservation
mark processed event
commit
```

## 19. Provider idempotency

Use:

```text
withdrawalId
```

as the fake provider's idempotency key.

The fake provider should return the same result/reference when the same Withdrawal is executed repeatedly.

This protects against:

```text
provider succeeds
worker crashes
Kafka redelivers
```

Document that real providers should support one of:

- idempotency key
- provider-side transaction lookup
- reconciliation

Do not claim local DB idempotency can guarantee exactly-once effects at a non-idempotent external provider.

## 20. Kafka consumer idempotency

Assume at-least-once delivery.

Create:

```text
processed_events
```

with:

```sql
UNIQUE(event_id)
```

The final settlement transaction must atomically:

```text
lock Withdrawal
check event
apply Withdrawal transition
finalize/release Wallet reservation
insert ProcessedEvent
commit
```

A duplicate event must not:

- call financial settlement twice
- finalize a reservation twice
- release twice
- transition terminal Withdrawal state
- create another balance mutation

## 21. Wallet settlement

Expose separate consumer-owned capability:

```ts
interface WalletSettlementPort {
  finalize(
    reservationId: ReservationId,
  ): Promise<void>;

  release(
    reservationId: ReservationId,
  ): Promise<void>;
}
```

Wallet domain behavior:

```ts
wallet.finalizeReservation(id);
wallet.releaseReservation(id);
```

Keep terminal reservation states explicit.

## 22. Redis

Use Redis only for a non-critical optimization such as:

```text
withdrawal rate limiting
```

Example:

```text
10 withdrawal requests/minute/user
```

If Redis is unavailable, financial correctness must remain unaffected.

Document the chosen fail-open or fail-closed behavior.

Do not use Redis as:

- wallet consistency guarantee
- sole idempotency guarantee
- sole distributed lock protecting balances

## 23. Query architecture

For:

```text
GET /withdrawals/{withdrawalId}
```

use a slice-specific read port:

```ts
interface WithdrawalQueryPort {
  getById(
    id: WithdrawalId,
  ): Promise<WithdrawalView | null>;
}
```

It may execute optimized SQL directly.

Do not force reads through the domain aggregate when no domain behavior is needed.

This is lightweight CQRS without introducing a CQRS framework.

## 24. Suggested project layout

```text
src/

  shared/
    domain/
      Money.ts
      Asset.ts
      DomainError.ts
      IntegrationEvent.ts

    application/
      ports/
        TransactionRunner.ts
        Clock.ts
        IdGenerator.ts
        Outbox.ts

    infrastructure/
      database/
        ClsTransactionRunner.ts

      outbox/
        PostgresOutbox.ts
        OutboxPublisher.ts

      observability/
        StructuredLogger.ts


  modules/

    wallet/

      domain/
        WalletAccount.ts
        Reservation.ts
        ReservationStatus.ts
        WalletErrors.ts

      application/

        reserve-funds/
          ReserveFundsService.ts

        finalize-reservation/
          FinalizeReservationService.ts

        release-reservation/
          ReleaseReservationService.ts

        ports/
          WalletRepository.ts

      infrastructure/
        persistence/
          PostgresWalletRepository.ts


    withdrawal/

      domain/
        Withdrawal.ts
        WithdrawalId.ts
        WithdrawalStatus.ts
        WithdrawalAddress.ts
        WithdrawalErrors.ts

      application/

        request-withdrawal/
          RequestWithdrawal.ts
          RequestWithdrawalCommand.ts
          RequestWithdrawalResult.ts

          ports/
            WalletReservationPort.ts
            WithdrawalIdempotencyPort.ts

        execute-withdrawal/
          ExecuteWithdrawal.ts

          ports/
            WalletSettlementPort.ts
            WithdrawalProvider.ts
            ProcessedEventPort.ts

        get-withdrawal/
          GetWithdrawal.ts

          ports/
            WithdrawalQueryPort.ts

        ports/
          WithdrawalRepository.ts

      infrastructure/

        adapters/
          WalletReservationAdapter.ts
          WalletSettlementAdapter.ts

        persistence/
          PostgresWithdrawalRepository.ts
          PostgresWithdrawalIdempotency.ts
          PostgresProcessedEvent.ts
          PostgresWithdrawalQuery.ts

        provider/
          FakeWithdrawalProvider.ts

        messaging/
          WithdrawalExecutionConsumer.ts

      presentation/
        http/
          WithdrawalController.ts
```

Adjust naming where necessary, but preserve the dependency boundaries.

## 25. Dependency rules

Enforce:

```text
domain
    depends on nothing external

application
    depends on domain + ports

presentation
    depends on application

infrastructure
    implements application ports
```

Cross-module:

```text
Withdrawal Application
        |
        v
consumer-owned Wallet port
        ^
        |
Wallet Adapter
        |
        v
Wallet Application
        |
        v
Wallet Domain
```

Do NOT allow:

```text
Withdrawal Domain -> Wallet Domain
Withdrawal -> PostgresWalletRepository
Domain -> NestJS
Domain -> ORM
Application -> EntityManager
Application -> TransactionHost
```

## 26. NestJS

Keep NestJS primarily in:

- presentation
- infrastructure
- composition root

Prefer plain TypeScript domain and application classes.

If `@Injectable()` is used pragmatically in application classes, ensure no business behavior depends on NestJS APIs.

Domain must remain completely framework-free.

## 27. Saga decision

Do NOT implement Saga for wallet reservation in this challenge.

Current architecture:

```text
Wallet
Withdrawal
same PostgreSQL
same transaction
```

Therefore use local ACID consistency.

Document future evolution:

If Wallet and Withdrawal later become:

```text
Wallet Service
    Wallet DB

Withdrawal Service
    Withdrawal DB
```

then replace the shared transaction with a Saga/process manager:

```text
PENDING_RESERVATION
    |
ReserveFunds
    |
FundsReserved / ReservationRejected
    |
continue / fail
```

At that point use:

- Saga
- Outbox
- Inbox
- compensating actions
- additional intermediate states

Do not add this complexity now.

## 28. Testing requirements

Implement all challenge-required tests plus the following.

### Domain tests

Wallet:

- reject zero amount
- reject negative amount
- insufficient available funds
- successful reservation
- duplicate Withdrawal reservation
- release reservation
- finalize reservation
- finalization twice rejected
- release after finalization rejected

Withdrawal:

- valid state transitions
- invalid transitions
- duplicate completion rejected
- duplicate failure rejected
- completed cannot regress

### Integration tests

RequestWithdrawal:

- successful request
- Wallet reserved
- Withdrawal created
- Outbox inserted
- idempotency record created

Rollback:

- Withdrawal persistence failure rolls back reservation
- Outbox failure rolls back Withdrawal and reservation
- idempotency persistence failure rolls back everything

Concurrent idempotency:

- two simultaneous identical requests
- one Withdrawal
- one reservation
- one Outbox event
- same logical response

Payload conflict:

- same Idempotency-Key
- different amount/payload
- reject conflict

Wallet concurrency:

```text
balance = 100
A = 80
B = 80
```

exactly one succeeds.

CLS:

- all participating repositories use same transaction
- transaction does not leak between concurrent requests
- critical repository mutation without active transaction fails

Kafka:

- duplicate event settles once
- duplicate success does not debit twice
- duplicate failure does not release twice
- processed event inserted atomically with settlement

Provider crash window:

- fake provider succeeds
- simulate crash before local settlement
- retry produces same provider transaction reference
- local settlement happens once

Redis:

- Redis unavailable
- financial flow remains correct

## 29. Observability

Use structured logging.

Include:

```text
correlationId
withdrawalId
userId
eventId
idempotencyKey where safe
operation
result
errorCode
```

Do not log:

- secrets
- tokens
- passwords
- complete sensitive payloads

Use AsyncLocalStorage/CLS for correlation/request metadata separately from domain logic if useful.

## 30. Documentation

Create:

```text
docs/
  ARCHITECTURE.md
  DOMAIN_MODEL.md
  DECISIONS.md
```

### ARCHITECTURE.md

Explain:

- Modular Monolith
- module boundaries
- Hexagonal Architecture
- Vertical Slice organization
- dependency direction
- CLS transaction propagation
- PostgreSQL transaction boundaries
- Outbox/Kafka flow
- Redis role

### DOMAIN_MODEL.md

Document:

- WalletAccount aggregate
- Withdrawal aggregate
- Reservation entity
- Money/Asset value objects
- invariants
- state transitions
- why Wallet and Withdrawal remain separate aggregates

### DECISIONS.md

Include at least:

1. PostgreSQL row locking for Wallet concurrency
2. PostgreSQL durable idempotency + request fingerprinting
3. Modular Monolith instead of microservices
4. `TransactionRunner` + CLS transaction propagation
5. Why Saga is not used
6. Consumer-owned cross-module ports
7. Why generic repositories are rejected
8. Provider idempotency strategy

## 31. Implementation order

Implement incrementally in this exact order.

### Phase 1 — Domain

Build and test:

- Money
- Asset
- WalletAccount
- Reservation
- Withdrawal
- state transitions
- invariants

No NestJS, DB, Kafka, or Redis yet.

### Phase 2 — Application contracts

Create:

- TransactionRunner
- Clock
- IdGenerator
- Outbox
- WalletRepository
- WithdrawalRepository
- WalletReservationPort
- WalletSettlementPort
- Idempotency port
- provider port
- processed-event port
- query port

Do not implement generic repository abstractions.

### Phase 3 — RequestWithdrawal

Implement the vertical slice using fake/in-memory ports.

Test orchestration and error handling.

### Phase 4 — PostgreSQL persistence

Implement:

- schema/migrations
- Wallet repository
- Withdrawal repository
- Reservation persistence
- idempotency
- Outbox
- processed event

Add constraints and indexes.

### Phase 5 — Transaction propagation

Add:

- `nestjs-cls`
- transactional adapter
- `ClsTransactionRunner`
- transaction-aware repositories
- active-transaction assertions

Add CLS integration tests.

### Phase 6 — Concurrency

Implement `SELECT ... FOR UPDATE`.

Create the required real PostgreSQL concurrent withdrawal test.

Do not mock concurrency.

### Phase 7 — Outbox

Implement:

- event persistence
- publisher
- retries
- safe row claiming
- Kafka publishing

### Phase 8 — Execution

Implement:

- Kafka consumer
- ExecuteWithdrawal
- fake provider
- provider idempotency
- success finalization
- failure release
- ProcessedEvent/Inbox logic

### Phase 9 — Redis

Add rate limiting only after financial correctness is complete.

### Phase 10 — Query/API

Implement:

```text
POST /withdrawals
GET /withdrawals/{id}
```

Keep controllers thin.

### Phase 11 — Documentation and review

Finish:

- README
- ARCHITECTURE.md
- DOMAIN_MODEL.md
- DECISIONS.md
- AI_USAGE.md
- required prompts

## 32. Review rules while implementing

Before accepting each implementation step, verify:

- Does business logic live in the domain where appropriate?
- Is infrastructure leaking into application/domain?
- Is this interface a real port or unnecessary abstraction?
- Does this cross-module dependency expose a capability rather than another module's repository?
- Is the financial operation protected by PostgreSQL?
- Is the transaction short?
- Could this operation execute twice?
- What happens after a crash at every external boundary?
- Is there a database constraint backing the most critical invariants?
- Is the test proving behavior against PostgreSQL rather than mocks where concurrency matters?

## 33. Definition of done

Do not consider the implementation complete until all of these hold:

```text
✓ domain contains meaningful business behavior
✓ no floating-point money
✓ Wallet and Withdrawal are separate aggregates
✓ RequestWithdrawal does not access WalletRepository
✓ transaction boundary is explicit
✓ CLS is infrastructure-only
✓ all financial writes share one PostgreSQL transaction
✓ wallet locking works under true concurrency
✓ duplicate HTTP requests cannot duplicate financial effects
✓ same idempotency key with another payload is rejected
✓ Outbox is atomic with business state
✓ Kafka duplicate delivery is harmless
✓ provider retry is idempotent
✓ failed withdrawal releases reservation
✓ successful withdrawal finalizes reservation
✓ Redis is not required for financial correctness
✓ no long-running DB transaction around provider calls
✓ no generic CRUD repository abstractions
✓ required documentation exists
✓ integration and concurrency tests pass
```

When making implementation choices not specified here, prefer the simplest design that preserves:

1. financial correctness,
2. explicit domain semantics,
3. dependency direction,
4. testability,
5. short transactions,
6. idempotency,
7. operational clarity.

Do not optimize for hypothetical microservices at the expense of today's correctness.
