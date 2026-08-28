# Application Layer Implementation Plan

## 1. Purpose and scope

Implement the application layer for the wallet-withdrawal workflow.

The application layer is responsible for:

- expressing business use cases,
- orchestrating domain aggregates,
- defining atomic transaction boundaries,
- defining inbound and outbound ports,
- coordinating Wallet and Withdrawal modules,
- durable HTTP idempotency,
- Outbox coordination,
- asynchronous Withdrawal execution,
- Kafka message idempotency,
- provider interaction through explicit ports,
- query use cases,
- application-specific errors and results.

The application layer must not contain:

- wallet arithmetic,
- Withdrawal transition rules,
- Reservation transition rules,
- SQL,
- ORM entities,
- Redis commands,
- Kafka producer/consumer implementation details,
- HTTP controllers,
- external provider SDK details,
- PostgreSQL transaction clients,
- `EntityManager`,
- `QueryRunner`,
- Prisma transaction clients,
- `TransactionHost`,
- explicit AsyncLocalStorage access.

The challenge requires reservation, Withdrawal creation, Outbox persistence, and durable idempotency to participate in one PostgreSQL transaction where applicable. fileciteturn0file0L119-L128

---

# 2. Architectural model

Use three complementary architectural ideas.

## Domain-Driven Design

The application layer coordinates the approved domain model:

```text
WalletAccount        Aggregate Root
WalletReservation    Aggregate Root
Withdrawal           Aggregate Root
```

It must not duplicate the invariants owned by these aggregates.

## Vertical Slice Architecture

Application behavior is organized around business use cases:

```text
RequestWithdrawal

ExecuteWithdrawal

GetWithdrawal
```

Wallet-side application capabilities include:

```text
ReserveFunds

FinalizeReservation

ReleaseReservation
```

Vertical slices define application cohesion.

## Hexagonal Architecture

Hexagonal Architecture defines dependency direction and system boundaries:

```text
Driving Adapter
    HTTP / Kafka / Job
        |
        v
Application Use Case
        |
        v
Domain
        |
        v
Outbound Port
        |
        v
Driven Adapter
    PostgreSQL / Provider / Outbox / Wallet module
```

The challenge explicitly asks for clear Domain, Application, and Infrastructure separation and for Wallet/Withdrawal modules to communicate through explicit boundaries. fileciteturn0file0L209-L268

---

# 3. Primary application rule

Use this rule throughout implementation:

> The domain decides whether a state transition is valid.  
> The application decides which domain operations participate in a business workflow.  
> Infrastructure performs IO and enforces physical transaction/concurrency mechanisms.

For example:

```text
WalletAccount.reserve()
```

is domain behavior.

But:

```text
load Wallet
reserve funds
create WalletReservation
create Withdrawal
persist Outbox
complete idempotency
```

is application orchestration.

---

# 4. Vertical slices are the primary application boundary

Do not create one large service such as:

```text
WithdrawalService
    request()
    execute()
    query()
    settle()
    retry()
```

Prefer separate use cases:

```text
RequestWithdrawal

ExecuteWithdrawal

GetWithdrawal
```

Each slice should contain only the contracts and helpers specific to that operation.

Conceptually:

```text
RequestWithdrawal
    input/command
    result
    use case
    slice-specific ports
    application errors


ExecuteWithdrawal
    input/command
    use case
    provider result types
    slice-specific ports


GetWithdrawal
    query/input
    result/view
    query port
```

Do not force this into a particular folder hierarchy.

Follow the existing codebase structure.

---

# 5. Inbound ports

For this application, the use-case class itself should normally be the inbound/driving port.

Example:

```ts
export class RequestWithdrawal {
  async execute(
    command: RequestWithdrawalCommand,
  ): Promise<RequestWithdrawalResult> {
    // orchestration
  }
}
```

Do not automatically create:

```ts
interface RequestWithdrawalUseCase {
  execute(...): Promise<...>;
}
```

with a second implementation class unless a real substitution boundary exists.

Avoid generic abstractions such as:

```ts
interface UseCase<I, O> {
  execute(input: I): Promise<O>;
}
```

They add little semantic value.

Concrete use-case classes are explicit, testable, and easy for NestJS to provide.

---

# 6. Outbound ports

Create ports only for capabilities the application requires but does not own.

Expected examples include:

```text
TransactionRunner

WalletReservationPort

WalletSettlementPort

WithdrawalRepository

RequestWithdrawalIdempotencyPort

OutboxWriter

WithdrawalProvider

ExecutionInboxPort

WithdrawalQueryPort

Clock

UniqueIdGenerator
```

Ports must describe semantic capabilities.

Good:

```ts
abstract class WalletReservationPort {
  abstract reserve(
    request: ReserveWalletFunds,
  ): Promise<ReservedWalletFunds>;
}
```

Bad:

```ts
interface DatabasePort {
  query(sql: string): Promise<unknown>;
}
```

Good:

```ts
abstract class WithdrawalProvider {
  abstract execute(
    command: ExecuteProviderWithdrawal,
  ): Promise<ProviderExecutionResult>;
}
```

Bad:

```ts
interface HttpClient {
  post<T>(...): Promise<T>;
}
```

when the application actually needs the business capability "execute Withdrawal."

---

# 7. Port ownership

Use consumer-owned ports for cross-module interaction.

`RequestWithdrawal` requires a capability from Wallet:

```text
reserve funds
```

Therefore Withdrawal application owns a contract such as:

```ts
export abstract class WalletReservationPort {
  abstract reserve(
    request: ReserveWalletFunds,
  ): Promise<ReservedWalletFunds>;
}
```

Conceptually:

```text
RequestWithdrawal
        |
        v
WalletReservationPort
        ^
        |
WalletReservationAdapter
        |
        v
Wallet ReserveFunds application operation
        |
        v
Wallet domain
```

This prevents Withdrawal from depending on Wallet's repositories or aggregates.

Do not inject:

```text
WalletRepository
WalletReservationRepository
WalletAccount
```

directly into `RequestWithdrawal`.

The challenge explicitly asks Wallet and Withdrawal to communicate through explicit application/domain boundaries. fileciteturn0file0L209-L234

---

# 8. Cross-module ports must be narrow

Do not create:

```ts
abstract class WalletPort {
  abstract reserve(...): Promise<...>;
  abstract release(...): Promise<...>;
  abstract finalize(...): Promise<...>;
  abstract balance(...): Promise<...>;
  abstract deposit(...): Promise<...>;
}
```

Use capability-specific ports.

For RequestWithdrawal:

```ts
abstract class WalletReservationPort {
  abstract reserve(
    request: ReserveWalletFunds,
  ): Promise<ReservedWalletFunds>;
}
```

For settlement:

```ts
abstract class WalletSettlementPort {
  abstract finalize(
    reservationId: ReservationId,
  ): Promise<void>;

  abstract release(
    reservationId: ReservationId,
  ): Promise<void>;
}
```

This follows Interface Segregation and minimizes cross-module coupling.

The same adapter may implement both contracts if convenient.

---

# 9. TypeScript port strategy for NestJS

For ports regularly injected through NestJS, prefer **abstract classes**.

Example:

```ts
export abstract class TransactionRunner {
  abstract run<T>(
    operation: () => Promise<T>,
  ): Promise<T>;
}
```

or:

```ts
export abstract class WithdrawalProvider {
  abstract execute(
    command: ExecuteProviderWithdrawal,
  ): Promise<ProviderExecutionResult>;
}
```

Reasons:

- provides compile-time contract,
- exists at runtime,
- can serve directly as a Nest DI token,
- avoids string tokens,
- avoids Symbol-token boilerplate,
- allows normal constructor injection.

Example:

```ts
@Injectable()
export class RequestWithdrawal {
  constructor(
    private readonly transactions:
      TransactionRunner,

    private readonly wallet:
      WalletReservationPort,
  ) {}
}
```

Nest wiring:

```ts
{
  provide: WalletReservationPort,
  useClass: WalletReservationAdapter,
}
```

---

# 10. When to use interfaces instead

Use a TypeScript `interface` when the contract is primarily compile-time and does not need to act directly as a Nest DI token.

Examples:

```text
small internal structural contracts
test-only contracts
non-DI configuration shapes
pure application data contracts
```

An `interface + Symbol` token remains valid when the existing codebase already uses that pattern.

Do not mix:

```text
abstract class ports
interface + Symbol ports
string-token ports
```

randomly.

Follow one consistent application convention.

Recommended default for this NestJS project:

```text
Nest-injected application port
    -> abstract class

Pure structural type
    -> interface / type

Use case
    -> concrete class

Alternative outcomes
    -> discriminated union
```

---

# 11. NestJS dependency policy

The Domain Layer remains completely framework-independent.

For the Application Layer, allowing:

```ts
@Injectable()
```

is an acceptable pragmatic choice.

Do not allow application behavior to depend on Nest APIs.

Acceptable:

```ts
@Injectable()
export class RequestWithdrawal {}
```

Reject:

```text
BadRequestException

HttpException

Request

Response

InjectRepository

TransactionHost

ConfigService containing business decisions

KafkaContext

Redis client
```

inside application orchestration.

Rule:

```text
Domain
    no NestJS

Application
    Nest DI metadata allowed
    no Nest-specific business behavior

Infrastructure / Presentation
    full Nest usage
```

If the existing codebase keeps application completely framework-neutral, keep that convention and use Nest `useFactory` composition instead.

Do not restructure the codebase solely for stylistic purity.

---

# 12. TransactionRunner

Use one shared technical port for application transactions.

Recommended:

```ts
export abstract class TransactionRunner {
  abstract run<T>(
    operation: () => Promise<T>,
  ): Promise<T>;
}
```

Do not expose:

```text
EntityManager
QueryRunner
Prisma.TransactionClient
TransactionHost
AsyncLocalStorage
Postgres Client
```

through the contract.

Application expresses:

```text
this workflow must execute atomically
```

Infrastructure decides how.

---

# 13. Transaction ownership

Every mutating application operation must be clearly classified as:

```text
transaction owner
```

or:

```text
transaction participant
```

For RequestWithdrawal:

```text
RequestWithdrawal
    OWNER

ReserveFunds
    PARTICIPANT

WithdrawalRepository
    PARTICIPANT

Wallet repositories
    PARTICIPANTS

Idempotency persistence
    PARTICIPANT

Outbox persistence
    PARTICIPANT
```

Only the top-level workflow starts the transaction.

Do not start independent transactions inside nested Wallet operations.

---

# 14. Transaction propagation

Application code should only contain:

```ts
return this.transactions.run(async () => {
  // workflow
});
```

Infrastructure may implement the physical transaction using:

```text
nestjs-cls
AsyncLocalStorage
TransactionHost
ORM transaction
```

The application must not know which mechanism is used.

Repositories and adapters participating in the workflow obtain the currently active transaction through infrastructure-level CLS propagation.

Do not pass transaction parameters:

```ts
wallet.reserve(command, tx);
```

or:

```ts
repository.save(entity, tx);
```

through application contracts.

---

# 15. Transaction-required capabilities

Financial mutation capabilities must document whether an active application transaction is required.

Examples:

```text
WalletReservationPort.reserve()
WalletSettlementPort.finalize()
WalletSettlementPort.release()
WithdrawalRepository.getForUpdate()
```

must normally execute inside an active transaction.

The contract does not accept a transaction parameter.

Infrastructure should fail fast if a critical mutation adapter is called outside the required transaction.

This prevents silent loss of locking/atomicity guarantees.

---

# 16. Shared technical application abstractions

Before adding shared abstractions, inspect the existing platform/application library.

Good candidates for genuinely shared technical contracts are:

```text
TransactionRunner

Clock

UniqueIdGenerator
```

Potentially:

```text
OutboxWriter

Inbox

ApplicationLogger
```

only if the platform already standardizes them.

Do not move business-specific ports into platform/shared code.

Keep these BC/slice-specific:

```text
WalletReservationPort

WalletSettlementPort

WithdrawalProvider

WithdrawalRepository

RequestWithdrawalIdempotencyPort

WithdrawalQueryPort
```

---

# 17. Generic abstractions to reject

Do not introduce:

```text
Repository<T>

CrudRepository<T>

UseCase<I, O>

ApplicationService<T>

QueryRepository<T>

Mapper<TSource, TDestination>

WalletPort

Provider<T>

GenericIdempotencyRepository<T>

GenericEventBus
```

without demonstrated reusable semantics.

Generic abstractions often erase the exact behavior that Hexagonal Architecture is supposed to make explicit.

---

# 18. Application commands

Commands should be immutable semantic inputs.

Example:

```ts
export type RequestWithdrawalCommand =
  Readonly<{
    idempotencyKey: IdempotencyKey;
    userId: UserId;
    amount: AssetAmount;
    destination: WithdrawalAddress;
  }>;
```

Do not duplicate asset separately if `AssetAmount` already contains it.

Avoid:

```ts
{
  asset: Asset;
  amount: AssetAmount;
}
```

unless the application genuinely needs both independently.

Make contradictory input states difficult or impossible to represent.

---

# 19. HTTP DTOs are not commands

HTTP DTO:

```text
raw strings
validation decorators
transport concerns
```

Application command:

```text
semantic values
domain/application types
immutable input
```

Flow:

```text
HTTP DTO
    |
    v
Controller / inbound mapper
    |
    v
RequestWithdrawalCommand
    |
    v
RequestWithdrawal
```

Do not pass Nest DTOs deeply into application code.

---

# 20. Validation responsibility

Use three levels.

## Transport validation

Examples:

```text
required header
required field
JSON type
maximum request-string length
```

Owned by controller/Kafka adapter.

## Domain validation

Examples:

```text
amount positive
valid asset arithmetic
valid Withdrawal transition
sufficient wallet balance
Reservation lifecycle
```

Owned by domain.

## Application validation

Examples:

```text
idempotency conflict
record not found
already processed event
workflow prerequisites
```

Owned by use cases.

Do not duplicate domain rules in application code.

---

# 21. Application results

Do not return aggregates directly from use cases.

Prefer:

```ts
export type RequestWithdrawalResult =
  Readonly<{
    withdrawalId: WithdrawalId;
    status: WithdrawalStatus;
    amount: AssetAmount;
  }>;
```

The HTTP adapter maps this to its response DTO.

This prevents API representation requirements from shaping the domain aggregate.

---

# 22. Type-safe alternative outcomes

Use discriminated unions for legitimate alternate outcomes.

Provider example:

```ts
export type ProviderExecutionResult =
  | Readonly<{
      kind: 'success';
      transactionReference: string;
    }>
  | Readonly<{
      kind: 'failure';
      reason: ProviderFailureReason;
    }>;
```

Do not use:

```ts
{
  success: boolean;
  transactionReference?: string;
  reason?: string;
}
```

because it allows invalid combinations.

---

# 23. Idempotency result

Recommended:

```ts
export type IdempotencyClaimResult =
  | Readonly<{
      kind: 'acquired';
    }>
  | Readonly<{
      kind: 'replay';
      result: RequestWithdrawalResult;
    }>
  | Readonly<{
      kind: 'conflict';
    }>;
```

Then handle exhaustively:

```ts
switch (claim.kind) {
  case 'acquired':
    break;

  case 'replay':
    return claim.result;

  case 'conflict':
    throw new IdempotencyKeyConflict();

  default:
    return assertNever(claim);
}
```

This ensures future variants cannot silently be ignored.

---

# 24. Error strategy

Distinguish three categories.

## Domain errors

Examples:

```text
InsufficientAvailableBalance
InvalidWithdrawalTransition
InvalidReservationTransition
```

## Application errors

Examples:

```text
IdempotencyKeyConflict
WithdrawalNotFound
InvalidExecutionMessage
```

## Infrastructure errors

Examples:

```text
PostgreSQL unavailable
provider timeout
Kafka unavailable
```

Do not add HTTP status codes to domain/application errors.

Controllers map errors to HTTP responses.

Do not catch every infrastructure failure and convert it into a business failure.

---

# 25. RequestWithdrawal dependencies

The final use case should conceptually depend on:

```text
TransactionRunner

RequestWithdrawalIdempotencyPort

WalletReservationPort

WithdrawalRepository

OutboxWriter

UniqueIdGenerator

Clock
```

It should not depend on:

```text
WalletRepository

WalletReservationRepository

WalletAccount

PostgreSQL

ORM

Redis

Kafka

TransactionHost

HTTP Request
```

---

# 26. RequestWithdrawal transaction

Required workflow:

```text
BEGIN

1. claim Idempotency-Key

2. if replay:
       return previous logical result

3. if same key + different fingerprint:
       reject

4. create WithdrawalId

5. reserve Wallet funds

6. create Withdrawal aggregate

7. persist Withdrawal

8. append WithdrawalExecutionRequested
   to Outbox

9. persist idempotency result

COMMIT
```

This directly implements the challenge requirements. fileciteturn0file0L119-L128

---

# 27. RequestWithdrawal conceptual implementation

```ts
@Injectable()
export class RequestWithdrawal {
  constructor(
    private readonly transactions:
      TransactionRunner,

    private readonly idempotency:
      RequestWithdrawalIdempotencyPort,

    private readonly wallet:
      WalletReservationPort,

    private readonly withdrawals:
      WithdrawalRepository,

    private readonly outbox:
      OutboxWriter,

    private readonly ids:
      UniqueIdGenerator,

    private readonly clock:
      Clock,
  ) {}

  async execute(
    command: RequestWithdrawalCommand,
  ): Promise<RequestWithdrawalResult> {
    return this.transactions.run(
      async () => {
        const claim =
          await this.idempotency.claim({
            key:
              command.idempotencyKey,

            fingerprint:
              createRequestFingerprint(
                command,
              ),
          });

        switch (claim.kind) {
          case 'replay':
            return claim.result;

          case 'conflict':
            throw new IdempotencyKeyConflict();

          case 'acquired':
            break;

          default:
            return assertNever(claim);
        }

        const withdrawalId =
          WithdrawalId.create(
            this.ids.generate(),
          );

        const reservation =
          await this.wallet.reserve({
            withdrawalId,
            userId: command.userId,
            amount: command.amount,
          });

        const withdrawal =
          Withdrawal.request({
            id: withdrawalId,
            userId: command.userId,
            amount: command.amount,
            destination:
              command.destination,
            reservationId:
              reservation.reservationId,
          });

        await this.withdrawals.add(
          withdrawal,
        );

        await this.outbox.append(
          createWithdrawalExecutionRequested({
            eventId:
              this.ids.generate(),

            withdrawal,

            occurredAt:
              this.clock.now(),
          }),
        );

        const result =
          toRequestWithdrawalResult(
            withdrawal,
          );

        await this.idempotency.complete(
          command.idempotencyKey,
          result,
        );

        return result;
      },
    );
  }
}
```

Exact names should follow existing codebase conventions.

---

# 28. Request fingerprint

Fingerprint only semantic request data.

Recommended:

```text
operation
userId
asset
atomic amount
normalized destination
```

Do not include:

```text
correlationId
timestamp
request arrival time
unrelated HTTP headers
```

Equivalent requests must produce equivalent fingerprints.

The challenge explicitly requires documenting payload fingerprinting and different-payload reuse behavior. fileciteturn0file0L382-L405

---

# 29. WalletReservationPort

Recommended:

```ts
export type ReserveWalletFunds =
  Readonly<{
    withdrawalId: WithdrawalId;
    userId: UserId;
    amount: AssetAmount;
  }>;

export type ReservedWalletFunds =
  Readonly<{
    reservationId: ReservationId;
  }>;

export abstract class WalletReservationPort {
  abstract reserve(
    request: ReserveWalletFunds,
  ): Promise<ReservedWalletFunds>;
}
```

The contract intentionally does not expose:

```text
WalletAccount
WalletReservation aggregate
repository
locking
transaction
database row
```

---

# 30. Wallet ReserveFunds application operation

Behind `WalletReservationPort`, Wallet application coordinates:

```text
obtain WalletAccount for protected mutation
        |
        v
wallet.reserve(amount)
        |
        v
create WalletReservation
        |
        v
persist WalletAccount
        |
        v
persist WalletReservation
```

This is a **transaction participant** when called from `RequestWithdrawal`.

Do not start a second transaction.

---

# 31. Repository contracts

Repositories must reflect aggregate-specific semantics.

Conceptually:

```ts
export abstract class WithdrawalRepository {
  abstract add(
    withdrawal: Withdrawal,
  ): Promise<void>;

  abstract getById(
    id: WithdrawalId,
  ): Promise<Withdrawal | null>;

  abstract getForUpdate(
    id: WithdrawalId,
  ): Promise<Withdrawal | null>;

  abstract save(
    withdrawal: Withdrawal,
  ): Promise<void>;
}
```

Wallet and WalletReservation receive their own repositories because the approved Domain Layer models them as separate Aggregate Roots.

Do not create `Repository<T>`.

---

# 32. Concurrency semantics

Application repository contracts may expose semantic mutation methods such as:

```text
getForUpdate
```

when a use case requires exclusive transactional mutation.

This communicates:

> obtain this aggregate for protected mutation.

It must not expose PostgreSQL-specific APIs.

Infrastructure may implement this with:

```text
SELECT ... FOR UPDATE
```

as required by the challenge's concurrency scenario. fileciteturn0file0L290-L333

---

# 33. OutboxWriter

Recommended technical contract:

```ts
export abstract class OutboxWriter {
  abstract append(
    event: IntegrationEvent,
  ): Promise<void>;
}
```

Promote it to a shared/platform abstraction only if multiple contexts genuinely share the same transactional Outbox semantics.

Otherwise keep it owned by this BC/application boundary.

Do not expose Kafka producer APIs through this port.

---

# 34. Integration event

Define an immutable, versioned contract.

Conceptually:

```ts
export type WithdrawalExecutionRequestedV1 =
  Readonly<{
    eventId: EventId;

    type:
      'withdrawal.execution-requested.v1';

    occurredAt: Instant;

    withdrawalId: WithdrawalId;
    userId: UserId;

    asset: string;
    amountAtomic: string;
  }>;
```

Do not serialize an entire `Withdrawal` aggregate.

Integration events are external contracts and should contain explicit serializable data.

The task requires an execution event persisted via Outbox and later published to Kafka. fileciteturn0file0L130-L170

---

# 35. ExecuteWithdrawal slice

Kafka is only the inbound adapter.

Flow:

```text
Kafka Consumer
       |
       v
deserialize event
       |
       v
ExecuteWithdrawalCommand
       |
       v
ExecuteWithdrawal
```

The Kafka consumer must not contain:

```text
Withdrawal transition logic
Wallet settlement logic
provider decision logic
Inbox business handling
```

These belong to the application/domain.

---

# 36. ExecuteWithdrawal transaction strategy

Do not hold a PostgreSQL transaction during the provider call.

Use three phases.

## Phase 1 — prepare execution

Short transaction:

```text
BEGIN

check execution state

load/lock Withdrawal

if PENDING:
    startProcessing()

if PROCESSING:
    allow safe resume

if terminal:
    handle idempotently

persist

COMMIT
```

Return only the immutable data needed to call the provider.

---

# 37. Phase 2 — provider call

Outside PostgreSQL transaction:

```text
WithdrawalProvider.execute(...)
```

Recommended provider input:

```ts
export type ExecuteProviderWithdrawal =
  Readonly<{
    idempotencyKey: WithdrawalId;
    amount: AssetAmount;
    destination: WithdrawalAddress;
  }>;
```

Use `WithdrawalId` as provider-side idempotency key when possible.

---

# 38. Provider result

Use:

```ts
export type ProviderExecutionResult =
  | Readonly<{
      kind: 'success';
      transactionReference: string;
    }>
  | Readonly<{
      kind: 'failure';
      reason: ProviderFailureReason;
    }>;
```

A provider-declared failure is a business execution result.

A timeout/network crash is a technical failure.

Do not convert technical uncertainty into a final failed Withdrawal automatically.

---

# 39. Phase 3 — settlement

Short transaction:

```text
BEGIN

check event is not already settled

load/lock Withdrawal

SUCCESS
    WalletSettlementPort.finalize()
    Withdrawal.complete()

FAILURE
    WalletSettlementPort.release()
    Withdrawal.fail()

record ProcessedEvent / Inbox

COMMIT
```

Wallet settlement internally coordinates:

```text
WalletReservation
+
WalletAccount
```

in the same active transaction.

The challenge explicitly requires duplicate Kafka messages not to settle balances twice. fileciteturn0file0L406-L433

---

# 40. WalletSettlementPort

Recommended:

```ts
export abstract class WalletSettlementPort {
  abstract finalize(
    reservationId: ReservationId,
  ): Promise<void>;

  abstract release(
    reservationId: ReservationId,
  ): Promise<void>;
}
```

The adapter behind this port owns Wallet-specific orchestration.

Withdrawal application does not need to know how WalletAccount and WalletReservation interact internally.

---

# 41. Inbox / ProcessedEvent

Prefer an existing platform Inbox abstraction if one already exists.

Otherwise introduce only the capability needed by this slice.

Conceptually:

```ts
export abstract class ExecutionInboxPort {
  abstract isProcessed(
    eventId: EventId,
  ): Promise<boolean>;

  abstract markProcessed(
    eventId: EventId,
  ): Promise<void>;
}
```

The persistence implementation must additionally enforce unique `eventId`.

Do not mark the event processed before external execution.

`ProcessedEvent` means:

```text
the execution outcome was safely settled
```

not:

```text
a worker started processing the message
```

---

# 42. PROCESSING retries

Kafka redelivery may encounter:

```text
Withdrawal = PROCESSING
```

This must be resumable.

A previous worker may have crashed:

```text
after PROCESSING commit
before provider call
```

or:

```text
after provider success
before local settlement
```

Therefore do not simply discard PROCESSING messages.

Provider idempotency makes retrying the external call safe.

For the fake provider, repeated execution using the same Withdrawal ID should return the same logical result/reference.

---

# 43. GetWithdrawal slice

Queries should not automatically reconstitute the aggregate.

Use a query-specific driven port:

```ts
export abstract class WithdrawalQueryPort {
  abstract findById(
    id: WithdrawalId,
  ): Promise<WithdrawalView | null>;
}
```

Application view:

```ts
export type WithdrawalView =
  Readonly<{
    withdrawalId: WithdrawalId;
    status: WithdrawalStatus;
    amount: AssetAmount;
    transactionReference:
      string | null;
    createdAt: Instant;
  }>;
```

Infrastructure may implement optimized SQL directly.

This is lightweight CQRS without requiring a CQRS framework.

---

# 44. Do not introduce Nest CQRS automatically

Do not add:

```text
CommandBus
QueryBus
EventBus
CommandHandler
QueryHandler
```

solely to say the project uses CQRS or Vertical Slices.

Direct use-case invocation is clearer for this challenge:

```ts
requestWithdrawal.execute(...)
```

If the existing project already standardizes `@nestjs/cqrs`, follow the existing convention rather than introducing a second application style.

---

# 45. Saga decision

Do not use Saga for RequestWithdrawal.

Current architecture:

```text
Wallet
WalletReservation
Withdrawal
Outbox

same PostgreSQL transaction capability
```

The task explicitly requires strong atomicity during withdrawal creation. fileciteturn0file0L119-L128

Saga becomes appropriate only if Wallet and Withdrawal later have independent transactional stores.

At that point the model must change to eventual consistency and additional intermediate states.

Do not add Saga abstractions now.

---

# 46. Modern TypeScript rules

Prefer strong compiler settings where compatible with the codebase.

Recommended:

```text
strict
exactOptionalPropertyTypes
noUncheckedIndexedAccess
noImplicitReturns
noFallthroughCasesInSwitch
noImplicitOverride
```

Do not force a project-wide migration if enabling one option creates large unrelated changes.

For new application code, follow the same discipline regardless.

---

# 47. Type-safety practices

Prefer:

```text
readonly commands
readonly results
readonly events
readonly port messages
```

Use:

```text
unknown
```

rather than:

```text
any
```

at uncertain boundaries.

Use:

```text
discriminated unions
```

instead of several optional fields representing a state machine.

Use:

```text
satisfies
```

for configuration/event/provider maps where it preserves inference while verifying structure.

Use:

```text
import type
```

for compile-time-only dependencies where consistent with project tooling.

---

# 48. No generic Result abstraction unless already established

Do not introduce:

```text
Result<T, E>
Either<E, T>
```

across the codebase solely for this task.

Use:

```text
typed domain/application errors
```

for exceptional/rejected operations.

Use:

```text
discriminated unions
```

for expected alternate protocol outcomes such as:

```text
provider success/failure

idempotency acquired/replay/conflict
```

If the existing codebase already has a well-established Result abstraction, use it consistently.

---

# 49. Application logging

Reuse an existing platform logging/telemetry abstraction if available.

Useful fields include those requested by the challenge:

```text
correlationId
withdrawalId
userId
eventId
operation
result
errorCode
```

fileciteturn0file0L583-L617

Do not inject logging concerns into domain objects.

Request/correlation context may be propagated using platform CLS infrastructure.

---

# 50. Nest composition

Prefer straightforward Nest provider registration.

For an abstract-class port:

```ts
{
  provide: WalletReservationPort,
  useClass: WalletReservationAdapter,
}
```

Use cases can generally be ordinary Nest providers:

```ts
@Injectable()
export class RequestWithdrawal {}
```

This provides good Nest ergonomics without forcing infrastructure concerns into the application design.

Do not use request-scoped use cases merely to propagate transactions or correlation context.

---

# 51. Application unit tests

Application unit tests should not require:

```text
Nest testing module
PostgreSQL
Redis
Kafka
CLS
```

Instantiate use cases directly with focused test doubles.

Example:

```ts
const useCase =
  new RequestWithdrawal(
    transactions,
    idempotency,
    wallet,
    withdrawals,
    outbox,
    ids,
    clock,
  );
```

Nest module wiring should have separate composition/integration tests.

---

# 52. RequestWithdrawal test matrix

Test:

```text
successful orchestration

idempotency acquired

idempotency replay
    returns previous result
    does not reserve again

idempotency conflict
    rejects
    does not reserve

wallet domain failure propagates

Withdrawal created after reservation

Withdrawal persisted

Outbox appended

idempotency completed

TransactionRunner invoked exactly once

same semantic command creates correct fingerprint
```

Database rollback itself must be tested later against PostgreSQL, not only with mocks.

---

# 53. ExecuteWithdrawal test matrix

Test:

```text
PENDING -> PROCESSING

PROCESSING can resume

terminal Withdrawal handled idempotently

provider receives WithdrawalId
as idempotency key

provider success
    Wallet finalized
    Withdrawal completed

provider declared failure
    Wallet released
    Withdrawal failed

provider technical exception
    no final settlement occurs

processed event marked only
after successful settlement

duplicate processed message
does not settle twice
```

---

# 54. Query tests

Test:

```text
existing Withdrawal returned

missing Withdrawal handled

query port invoked correctly

no domain mutation

no unnecessary transaction
```

---

# 55. Nest composition tests

Verify:

```text
use cases resolve from Nest

abstract-class ports map
to intended adapters

TransactionRunner maps
to CLS implementation

WalletReservationPort maps
to Wallet adapter

WithdrawalProvider maps
to fake provider

OutboxWriter maps
to persistence adapter

application providers remain singleton
unless explicitly justified

module exports only intended
public application APIs
```

---

# 56. Application implementation sequence

## Step 1 — inspect existing application/platform abstractions

Identify existing:

```text
transaction abstraction
Clock
ID generation
Outbox
Inbox
logging
Nest DI conventions
application errors
command/query conventions
```

Reuse semantically correct abstractions.

Do not build competing infrastructure abstractions.

## Step 2 — define vertical slices

Establish:

```text
RequestWithdrawal
ExecuteWithdrawal
GetWithdrawal
```

and Wallet capabilities needed by them.

## Step 3 — define immutable inputs/results

Use semantic domain/application types.

Do not use HTTP DTOs.

## Step 4 — define required ports only

Start with actual current dependencies.

Do not create future hypothetical ports.

## Step 5 — implement RequestWithdrawal

Use test doubles first.

No database or Nest container required.

## Step 6 — implement Wallet application operations

Implement:

```text
ReserveFunds
FinalizeReservation
ReleaseReservation
```

against Wallet domain/repository ports.

They participate in outer transactions.

## Step 7 — define integration event

Define and version:

```text
WithdrawalExecutionRequested
```

independently from Kafka implementation.

## Step 8 — implement ExecuteWithdrawal

Use:

```text
prepare transaction
provider call outside transaction
settlement transaction
```

with resumable/idempotent semantics.

## Step 9 — implement GetWithdrawal

Use an optimized query port.

## Step 10 — integrate NestJS

Register use cases and abstract-class ports using existing Nest module conventions.

## Step 11 — connect TransactionRunner to CLS infrastructure

Keep CLS entirely outside application behavior.

## Step 12 — verify boundaries

Confirm:

```text
no ORM leakage

no transaction object leakage

no Wallet repository access
from Withdrawal application

no long transactions
around provider calls

no unnecessary generic abstractions
```

---

# 57. Application code-review checklist

For every use case verify:

### Cohesion

```text
Can the business workflow be understood
from this slice?
```

### Domain ownership

```text
Is application code making a business
decision that belongs to an aggregate?
```

If yes, move it.

### Transaction ownership

```text
Who starts the transaction?
```

There must be one clear answer.

### Port semantics

```text
Does this port describe a capability,
not a technology?
```

### Port width

```text
Does the consumer receive only what
it needs?
```

### Cross-module dependencies

Reject direct imports of another module's repositories.

### Type safety

Check:

```text
no any
no ambiguous optional-field state machine
exhaustive union handling
immutable commands/results
```

### Infrastructure leakage

Reject:

```text
ORM
Postgres
Redis
Kafka clients
TransactionHost
CLS
HTTP
```

from core application behavior.

### External IO

Never hold a DB transaction while waiting for the provider.

### Abstraction quality

Remove interfaces/classes that only rename another abstraction.

---

# 58. Definition of done

The Application Layer is complete when:

```text
✓ application behavior is organized around vertical slices

✓ Hexagonal driving/driven boundaries are explicit

✓ RequestWithdrawal is a clear inbound use case

✓ ExecuteWithdrawal is a clear inbound use case

✓ GetWithdrawal is a clear inbound use case

✓ cross-module interaction occurs through
  narrow capability ports

✓ RequestWithdrawal never accesses
  WalletRepository directly

✓ approved three-aggregate domain model
  is respected

✓ transaction ownership is explicit

✓ nested operations participate in
  the current transaction

✓ no transaction objects appear
  in application APIs

✓ CLS is not referenced by application code

✓ ORM and PostgreSQL types do not appear
  in application contracts

✓ Kafka and Redis clients do not appear
  in application contracts

✓ provider SDK types do not appear
  in application contracts

✓ NestJS DI remains ergonomic

✓ abstract classes are used consistently
  for Nest-managed ports

✓ use cases remain concrete classes

✓ no generic Repository<T> exists

✓ no generic UseCase<I,O> exists
  without genuine value

✓ commands and results are immutable

✓ provider outcomes are modeled
  with discriminated unions

✓ idempotency outcomes are exhaustive

✓ RequestWithdrawal performs all
  required writes atomically

✓ provider execution happens outside
  long DB transactions

✓ Kafka redelivery is resumable

✓ final settlement and ProcessedEvent
  recording are atomic

✓ query use cases may use optimized
  read projections

✓ application unit tests do not
  require NestJS

✓ Nest composition is tested separately

✓ existing platform abstractions are reused
  where their semantics genuinely match

✓ no unnecessary codebase restructuring
  is introduced
```

---

# Final application model

```text
                      DRIVING SIDE

              HTTP                 Kafka
               |                     |
               v                     v

       RequestWithdrawal       ExecuteWithdrawal
               |                     |
               |                     |
        APPLICATION CORE             |
               |                     |
     +---------+---------+           |
     |         |         |           |
     v         v         v           v
 Transaction Wallet   Withdrawal   Provider
   Runner     Port       Repo        Port
               |
               v
          Wallet Module
               |
               v
             Domain


                 GetWithdrawal
                       |
                       v
             WithdrawalQueryPort
                       |
                       v
                  Read Adapter


                    DRIVEN SIDE

 PostgreSQL / Wallet adapter / Outbox / Provider
```

The governing architectural rule is:

> **Vertical Slices define how application behavior is organized. Hexagonal Architecture defines how dependencies cross boundaries. DDD determines where business rules live. NestJS provides composition and runtime DI without becoming the architecture itself.**

Use the existing project structure, module conventions, and platform libraries. The plan defines ownership, dependency direction, contracts, and behavior; it does not require reorganizing the codebase into a prescribed directory layout.
