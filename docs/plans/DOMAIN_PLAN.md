# Domain Layer Implementation Plan

## 1. Purpose and scope

Implement the domain model for the wallet-withdrawal workflow using tactical Domain-Driven Design.

The domain layer must express and protect:

- exact digital-asset amounts,
- wallet balance invariants,
- reservation lifecycle,
- withdrawal lifecycle,
- valid state transitions,
- domain-level validation and errors.

The domain layer must not depend on:

- NestJS,
- HTTP,
- PostgreSQL,
- ORM entities,
- Redis,
- Kafka,
- Outbox infrastructure,
- transaction managers,
- AsyncLocalStorage / CLS,
- repositories,
- provider SDKs,
- application services.

Business rules must not exist only in controllers or application services. fileciteturn0file0L259-L268

This document defines domain responsibilities only. It does not prescribe folders or require changes to the existing project structure.

---

## 2. Architectural position

Treat Wallet and Withdrawal as separate domain modules or model boundaries unless the existing codebase already defines stronger Bounded Context boundaries.

Do not claim that they are separate Bounded Contexts solely because they are separate modules. A Bounded Context is an organizational and semantic boundary, not merely a directory or namespace.

The conceptual model is:

```text
Wallet model
    WalletAccount
    WalletReservation

Withdrawal model
    Withdrawal

Shared domain concepts
    Asset
    AssetAmount
```

The challenge describes Wallet and Withdrawal as separate modules with explicit boundaries. fileciteturn0file0L209-L234

The implementation should follow the existing codebase's module and platform conventions.

---

## 3. Aggregate strategy

Use three aggregate roots:

```text
WalletAccount
WalletReservation
Withdrawal
```

Each aggregate owns a focused consistency boundary.

Do not place all reservations inside `WalletAccount`:

```text
WalletAccount
    reservations: Reservation[]
```

A wallet can accumulate a large reservation history, making such an aggregate unbounded in size and responsibility.

The aggregates are coordinated by application workflows when a business operation spans more than one aggregate.

This is a pragmatic design. The challenge requires reservation, Withdrawal creation, and Outbox persistence to participate in one transaction. fileciteturn0file0L119-L128

---

## 4. Aggregate: WalletAccount

### Responsibility

`WalletAccount` owns the wallet's balance invariants and balance mutations.

It must be able to determine whether:

- an amount can be reserved,
- a reservation can be released,
- a reserved amount can be captured as a completed debit.

It must not know about:

- Withdrawals,
- reservation records,
- HTTP,
- idempotency keys,
- Kafka,
- providers,
- database locks,
- transactions,
- repositories.

### State

Conceptually:

```text
WalletId
UserId
Asset
TotalBalance
ReservedBalance
```

`AvailableBalance` should be derived:

```text
availableBalance = totalBalance - reservedBalance
```

Do not maintain `totalBalance`, `reservedBalance`, and `availableBalance` as independently mutable state.

### Public behavior

Use domain terminology already established in the codebase. The following names are recommendations:

```text
reserve(amount)
releaseReserved(amount)
captureReserved(amount)
```

If the existing ubiquitous language uses `debitReserved`, `consumeReservation`, or another precise term, use that consistently.

---

## 5. WalletAccount invariants

`WalletAccount` must never expose an invalid state.

Required invariants:

```text
totalBalance >= 0

reservedBalance >= 0

reservedBalance <= totalBalance

availableBalance >= 0
```

The challenge explicitly requires available balance never to become negative and reserved balance never to exceed total balance. fileciteturn0file0L270-L288

Validate these invariants:

- when creating a new account,
- when reconstituting persisted state,
- after every state-changing operation.

Do not rely only on database constraints. Database constraints are defense in depth; the aggregate must still protect its own invariants.

---

## 6. WalletAccount behavior

### reserve

Semantics:

```text
reserve(amount)

Require:
    amount is positive
    amount uses the wallet asset
    availableBalance >= amount

Effect:
    reservedBalance += amount
```

Example:

```text
Before

total      = 100 USDT
reserved   =   0 USDT
available  = 100 USDT

reserve 80 USDT

After

total      = 100 USDT
reserved   =  80 USDT
available  =  20 USDT
```

Reject:

- zero amounts,
- negative amounts,
- mismatched assets,
- amounts greater than available balance.

### releaseReserved

Semantics:

```text
releaseReserved(amount)

Require:
    amount is positive
    amount uses the wallet asset
    reservedBalance >= amount

Effect:
    reservedBalance -= amount
```

### captureReserved

Semantics:

```text
captureReserved(amount)

Require:
    amount is positive
    amount uses the wallet asset
    reservedBalance >= amount

Effect:
    reservedBalance -= amount
    totalBalance -= amount
```

Example:

```text
Before

total      = 100
reserved   =  80
available  =  20

capture 80

After

total      = 20
reserved   =  0
available  = 20
```

`captureReserved` represents successful settlement of funds that were already reserved.

---

## 7. Aggregate: WalletReservation

### Responsibility

`WalletReservation` owns the lifecycle of one reservation.

It does not calculate wallet availability and must not directly mutate `WalletAccount`.

### State

Conceptually:

```text
ReservationId
WalletId
WithdrawalId
AssetAmount
ReservationStatus
```

Recommended statuses:

```text
ACTIVE
FINALIZED
RELEASED
```

The exact names may follow existing project terminology.

### Why it is an aggregate root

Model the reservation as an independent aggregate when it:

- has its own identity,
- has its own lifecycle,
- is persisted independently,
- is loaded independently,
- is transitioned independently,
- participates in independent concurrency control.

Do not model it as a child collection of `WalletAccount` merely because it is related to the wallet.

---

## 8. WalletReservation lifecycle

Valid transitions:

```text
ACTIVE
  ├──> FINALIZED
  └──> RELEASED
```

Invalid transitions:

```text
FINALIZED -> RELEASED

RELEASED -> FINALIZED

FINALIZED -> FINALIZED

RELEASED -> RELEASED
```

Recommended behavior:

```text
reservation.finalize()

reservation.release()
```

Each method must validate the current status before changing it.

A terminal reservation must remain terminal.

---

## 9. Reservation and Withdrawal relationship

A reservation should reference the Withdrawal it belongs to:

```text
WalletReservation
    reservationId
    walletId
    withdrawalId
    amount
    status
```

This relationship is useful for:

- settlement processing,
- reconciliation,
- idempotency,
- persistence uniqueness,
- tracing the financial workflow.

However, the aggregate cannot determine whether another reservation with the same `withdrawalId` already exists.

Therefore, “one reservation per Withdrawal” is a cross-instance invariant protected by:

```text
application workflow
+
persistence uniqueness constraint
```

The domain object should validate its own state, but it should not pretend to enforce global uniqueness in memory.

The challenge requires duplicate requests not to reserve funds twice. fileciteturn0file0L270-L280

---

## 10. Aggregate: Withdrawal

### Responsibility

`Withdrawal` owns the lifecycle of a withdrawal request and execution attempt.

It should contain:

- Withdrawal identity,
- user identity,
- requested amount,
- destination,
- reservation reference,
- current status,
- provider reference after successful execution,
- failure information where applicable.

It must not know about:

- `WalletAccount` implementation,
- `WalletReservation` implementation,
- repositories,
- Kafka,
- Outbox,
- PostgreSQL,
- HTTP idempotency,
- transaction managers,
- provider SDKs.

---

## 11. Withdrawal lifecycle

Recommended state model:

```text
PENDING
    |
    v
PROCESSING
   /       \
  v         v
COMPLETED  FAILED
```

Meaning:

```text
PENDING
    Withdrawal accepted and funds reserved,
    but execution has not started.

PROCESSING
    Execution has started.

COMPLETED
    Execution succeeded.

FAILED
    Execution failed and the reservation was released
    by the surrounding application workflow.
```

The challenge's example POST response returns `PENDING`, making this model natural. fileciteturn0file0L108-L116

Do not add `FUNDS_RESERVED` unless the system needs to expose or process that state independently. If reservation and Withdrawal creation are committed atomically, `PENDING` can represent the accepted-and-reserved state.

The specification permits a different state model if it is explicitly modeled and justified. fileciteturn0file0L468-L508

---

## 12. Withdrawal behavior

Recommended methods:

```text
startProcessing()

complete(providerReference)

fail(reason)
```

### startProcessing

Valid transition:

```text
PENDING -> PROCESSING
```

Reject calls from:

```text
COMPLETED
FAILED
```

### complete

Valid transition:

```text
PROCESSING -> COMPLETED
```

Require a valid provider reference if the domain considers it mandatory.

Reject:

```text
PENDING -> COMPLETED
COMPLETED -> COMPLETED
FAILED -> COMPLETED
```

### fail

Valid transition:

```text
PROCESSING -> FAILED
```

Require a meaningful failure reason if failure reasons are part of the domain model.

Reject:

```text
PENDING -> FAILED
COMPLETED -> FAILED
FAILED -> FAILED
```

If the business must support failure before processing begins, model that explicitly rather than silently broadening the transition rules.

Terminal states must never regress. The challenge explicitly requires invalid transitions such as `COMPLETED -> PROCESSING` to be rejected. fileciteturn0file0L468-L516

---

## 13. Cross-aggregate settlement behavior

Do not make one aggregate manipulate another.

Avoid:

```text
withdrawal.complete(wallet)
withdrawal.fail(wallet)
withdrawal.reserve(wallet)
reservation.finalize(wallet)
```

Instead, the application workflow coordinates the aggregates.

### Successful settlement

Conceptually:

```text
reservation.finalize()

wallet.captureReserved(
    reservation.amount
)

withdrawal.complete(
    providerReference
)
```

### Failed settlement

Conceptually:

```text
reservation.release()

wallet.releaseReserved(
    reservation.amount
)

withdrawal.fail(
    reason
)
```

The challenge requires successful withdrawals to finalize reserved funds and failed withdrawals to release them. fileciteturn0file0L63-L75

This is a cross-aggregate consistency workflow. It should be coordinated by the application layer inside the required transaction, not hidden inside one aggregate.

---

## 14. Value Object: AssetAmount

Use an exact value object for digital-asset amounts.

Conceptually:

```text
AssetAmount
    Asset
    AtomicUnits
```

`Money` is also acceptable if that is the established term in the codebase. Do not introduce `AssetAmount` merely to rename an existing, semantically correct platform type.

### Representation

Prefer integer atomic units:

```text
atomicUnits: bigint
```

Example:

```text
100 USDT
=
100_000_000 atomic units
```

The exact conversion depends on the asset precision.

Never use JavaScript floating-point `number` for financial calculations.

The challenge explicitly prohibits floating-point monetary calculations and permits integer minor units or Decimal-based approaches. fileciteturn0file0L274-L288

### Immutability

`AssetAmount` should be immutable.

Operations should return new values:

```text
result = amount.add(other)
```

rather than mutating the original instance.

---

## 15. AssetAmount behavior

Recommended operations:

```text
add(other)
subtract(other)
equals(other)
isZero()
isPositive()
isLessThan(other)
isGreaterThan(other)
isGreaterThanOrEqual(other)
```

All arithmetic and comparison operations involving two amounts must verify that the assets match.

Invalid:

```text
100 USDT + 1 BTC
```

The value object should reject asset mismatch rather than allowing callers to compare or combine incompatible amounts.

`subtract` must reject results below zero unless the existing domain explicitly models negative balances. This wallet domain does not.

---

## 16. Zero and positive amounts

Use one non-negative amount type unless the existing codebase already uses refined amount types.

Recommended rule:

```text
AssetAmount >= 0
```

Then enforce strict positivity in operations that require a positive amount:

```text
WalletAccount.reserve()
WalletReservation.open()
Withdrawal.request()
```

This allows zero balances to be represented naturally while preventing zero-value reservations and withdrawals.

Do not introduce `PositiveAssetAmount` unless the project already has a consistent refined-value-object approach and the additional type materially improves correctness.

---

## 17. Value Object: Asset

`Asset` should represent a supported digital asset rather than an arbitrary string.

It should provide enough information to:

- identify the asset,
- determine its precision,
- compare asset identity,
- support exact amount conversion.

Do not build an asset-management subsystem in this domain phase.

If the existing platform library already provides a canonical asset type, reuse it only if its semantics match this domain. A generic fiat-oriented money type should not be reused if it assumes fixed two-decimal precision.

---

## 18. Value Object: WithdrawalAddress

Use a dedicated immutable value object for the destination.

It should provide only validation justified by the current domain:

- reject empty values,
- apply safe normalization if appropriate,
- enforce a sensible maximum length,
- preserve the validated value.

Do not implement blockchain-specific address validation unless the business explicitly requires it.

The challenge states that blockchain integration is out of scope. fileciteturn0file0L518-L545

If the platform library already contains a semantically correct destination/address type, reuse it.

---

## 19. Identity types

Use strong identity types where they improve correctness:

```text
WalletId
ReservationId
WithdrawalId
UserId
```

The implementation may use branded types, value objects, classes, or the existing project convention.

The important requirement is that identities are not accidentally interchangeable.

Do not create separate classes for every ID if the existing codebase already has a reliable typed-ID strategy.

---

## 20. Creation and reconstitution

Separate creation of new domain objects from reconstitution of persisted state.

Recommended conceptual operations:

```text
WalletAccount.open(...)
WalletReservation.open(...)
Withdrawal.request(...)
```

and:

```text
WalletAccount.reconstitute(...)
WalletReservation.reconstitute(...)
Withdrawal.reconstitute(...)
```

Names may follow existing conventions.

Creation methods enforce business rules for new objects.

Reconstitution methods validate that persisted state is structurally and semantically valid.

Do not allow ORM mappers to bypass encapsulation by mutating private fields after construction.

If the persistence model contains invalid state, fail during reconstitution rather than silently creating an invalid aggregate.

---

## 21. Domain errors

Use domain-specific errors for rejected business operations.

Examples:

```text
InvalidAssetAmount
AssetMismatch

InsufficientAvailableBalance
InvalidWalletState

InvalidReservationAmount
InvalidReservationTransition

InvalidWithdrawalAmount
InvalidWithdrawalTransition
InvalidWithdrawalAddress
```

Errors should express domain meaning.

They must not contain transport or infrastructure concerns such as:

```text
HTTP status codes
SQL error codes
Kafka offsets
NestJS exception types
database connection details
```

Mapping domain errors to HTTP or messaging responses belongs outside the domain.

If the platform library already provides a suitable domain-error abstraction, reuse it rather than introducing a second hierarchy.

---

## 22. Domain services

Do not introduce a Domain Service initially.

Current responsibilities have natural owners:

```text
AssetAmount
    exact arithmetic

WalletAccount
    balance invariants

WalletReservation
    reservation lifecycle

Withdrawal
    withdrawal lifecycle
```

Avoid generic services such as:

```text
WalletDomainService
WithdrawalDomainService
ReservationDomainService
FinancialDomainService
```

Introduce a Domain Service only if a real domain operation emerges that:

1. does not naturally belong to one aggregate or Value Object,
2. represents meaningful domain language,
3. does not require infrastructure,
4. cannot be expressed through existing aggregate behavior.

Cross-aggregate transaction orchestration is not a reason to create a Domain Service. It belongs to the application layer.

---

## 23. Domain events

Do not introduce a Domain Event framework solely for architectural symmetry.

The challenge requires `WithdrawalExecutionRequested` for asynchronous execution and Outbox/Kafka processing. fileciteturn0file0L130-L170

Whether that message is modeled as:

- an integration event created by the application layer,
- a domain event collected by an aggregate,
- or another project-specific event abstraction,

should follow the existing architecture.

For this domain phase, do not add event dispatching, handlers, brokers, or persistence.

The critical financial workflow should remain explicit and deterministic.

Introduce domain events only when the domain has a genuine event-driven reaction, not merely because an event can be named.

---

## 24. Repository and persistence boundaries

Repositories are not domain objects and should not be referenced by aggregates.

Repository contracts should remain in the existing application/port boundary used by the codebase.

The domain must not know whether persistence uses:

- PostgreSQL,
- an ORM,
- raw SQL,
- another database,
- an in-memory test adapter.

The domain model should be usable in unit tests without persistence.

---

## 25. Transaction boundaries

No domain method should accept infrastructure transaction objects:

```text
Transaction
TransactionContext
EntityManager
QueryRunner
PrismaTransactionClient
CLS context
```

Incorrect:

```text
wallet.reserve(amount, transaction)
```

Correct:

```text
wallet.reserve(amount)
```

The application layer decides whether the operation runs inside a transaction.

The challenge requires transaction correctness, but that requirement must not leak into domain APIs. fileciteturn0file0L335-L355

---

## 26. Concurrency boundaries

The domain protects business invariants:

```text
available balance cannot become negative
reserved balance cannot exceed total balance
```

The application and infrastructure layers protect concurrent execution using the selected persistence strategy.

Possible strategies include:

- row-level locking,
- optimistic concurrency,
- conditional updates,
- Serializable transactions.

The challenge explicitly rejects in-memory locking as the financial guarantee. fileciteturn0file0L290-L333

The domain must remain unaware of the selected concurrency mechanism.

---

## 27. Persistence defense in depth

The domain remains responsible for aggregate invariants.

Persistence should additionally enforce structural and cross-instance guarantees such as:

```text
non-negative balances
reserved balance not greater than total balance
one wallet per user and asset
one reservation per Withdrawal
```

Use:

```text
domain validation
+
persistence constraints
```

Do not remove domain validation because a database constraint exists.

Do not move all business rules into database triggers or check constraints. The domain model must remain understandable and testable independently.

---

## 28. Ownership matrix

| Rule                                 | Owner                                        |
| ------------------------------------ | -------------------------------------------- |
| Exact asset arithmetic               | `AssetAmount`                                |
| Asset mismatch prevention            | `AssetAmount`, `WalletAccount`               |
| Withdrawal amount must be positive   | `Withdrawal`                                 |
| Reservation amount must be positive  | `WalletReservation`                          |
| Available balance cannot go negative | `WalletAccount`                              |
| Reserved balance cannot exceed total | `WalletAccount`                              |
| Cannot reserve more than available   | `WalletAccount`                              |
| Reservation lifecycle                | `WalletReservation`                          |
| Withdrawal lifecycle                 | `Withdrawal`                                 |
| Completed Withdrawal cannot regress  | `Withdrawal`                                 |
| Failed Withdrawal releases funds     | Application workflow coordinating aggregates |
| Successful Withdrawal captures funds | Application workflow coordinating aggregates |
| One reservation per Withdrawal       | Application workflow plus persistence        |
| Same idempotency key once            | Application plus persistence                 |
| Kafka event deduplication            | Application plus persistence                 |
| PostgreSQL transaction atomicity     | Application and infrastructure               |
| Provider idempotency                 | Application/provider boundary                |

Do not force cross-aggregate or cross-request rules into a single aggregate.

---

## 29. Shared and platform primitives

Do not create new shared-domain abstractions before inspecting the existing platform library and common domain code.

Potentially reusable concepts include:

```text
Asset
AssetAmount / Money
UserId
DomainError
typed IDs
```

Reuse an existing platform abstraction when:

- its semantics match,
- its invariants are appropriate,
- its ownership is genuinely shared,
- extending it will not introduce domain-specific coupling.

Do not reuse a type merely because its structure looks similar.

For example, do not reuse a generic two-decimal fiat `Money` type for crypto amounts if it cannot represent asset-specific precision exactly.

If a shared primitive is semantically correct, prefer using or extending it in its existing location rather than moving it to satisfy this plan.

---

## 30. Placement guidance

This plan intentionally does not prescribe directories.

Use the existing codebase's conventions and dependency boundaries.

Recommended ownership:

```text
Asset / AssetAmount
    existing platform/shared domain library,
    when genuinely shared

WalletAccount / WalletReservation
    Wallet domain ownership

Withdrawal / WithdrawalAddress
    Withdrawal domain ownership

Domain errors
    near their owning concepts,
    or existing domain-error infrastructure
```

Folder names are not the architecture.

The important constraints are:

- domain ownership is clear,
- dependencies point inward,
- shared concepts are genuinely shared,
- infrastructure does not leak into the domain.

---

## 31. Unit testing strategy

Domain tests must run without:

```text
NestJS
PostgreSQL
Redis
Kafka
CLS
HTTP
ORM
```

### AssetAmount tests

Cover:

```text
exact atomic-unit representation
creation of zero
creation of positive values
rejection of negative values
addition
subtraction
comparison
asset mismatch
immutability
precision handling
```

### WalletAccount tests

Cover:

```text
valid initial state
successful reservation
reservation equal to available balance
reservation greater than available rejected
multiple valid reservations
release of reserved amount
capture of reserved amount
release greater than reserved rejected
capture greater than reserved rejected
asset mismatch rejected
reserved balance never exceeds total balance
available balance derived correctly
invalid reconstituted state rejected
```

### WalletReservation tests

Cover:

```text
new reservation starts ACTIVE
positive amount required
ACTIVE -> FINALIZED
ACTIVE -> RELEASED
FINALIZED -> RELEASED rejected
RELEASED -> FINALIZED rejected
duplicate finalization rejected
duplicate release rejected
invalid reconstituted state rejected
```

### Withdrawal tests

Cover:

```text
new Withdrawal starts PENDING
positive amount required
PENDING -> PROCESSING
PROCESSING -> COMPLETED
PROCESSING -> FAILED
provider reference stored on completion
failure reason stored where modeled
invalid transitions rejected
terminal states cannot regress
duplicate completion rejected
duplicate failure rejected
invalid reconstituted state rejected
```

The challenge explicitly requires unit coverage for invalid amounts, insufficient balance, successful reservation, reservation release, invalid Withdrawal transitions, and duplicate completion prevention. fileciteturn0file0L546-L557

---

## 32. Implementation sequence

### Step 1 — Inspect existing primitives

Identify existing implementations of:

```text
Asset
Money / AssetAmount
typed IDs
domain errors
```

Reuse only when semantics match.

Do not refactor the platform library unnecessarily.

### Step 2 — Implement or confirm Asset and AssetAmount

Establish exact arithmetic before implementing wallet or Withdrawal behavior.

Complete value-object tests first.

### Step 3 — Implement WalletAccount

Implement:

```text
balance state
available balance derivation
reserve
releaseReserved
captureReserved
invariant validation
creation
reconstitution
```

Complete all balance tests.

### Step 4 — Implement WalletReservation

Implement:

```text
identity
wallet reference
Withdrawal reference
amount
status
finalize
release
creation
reconstitution
```

Complete lifecycle tests.

### Step 5 — Implement WithdrawalAddress

Implement only the validation justified by the current domain.

Do not add blockchain-specific behavior.

### Step 6 — Implement Withdrawal

Implement:

```text
request
startProcessing
complete
fail
creation
reconstitution
state guards
```

Complete lifecycle tests.

### Step 7 — Review domain errors

Ensure rejected operations produce meaningful domain errors without infrastructure details.

### Step 8 — Review boundaries

Before moving to application code, verify:

```text
all financial calculations use exact arithmetic
all aggregate mutations preserve invariants
no aggregate directly manipulates another aggregate
no repository dependency exists
no transaction dependency exists
no infrastructure dependency exists
no unnecessary Domain Service exists
no unnecessary Domain Event framework exists
```

---

## 33. Explicitly out of scope

Do not implement these during the domain phase:

```text
NestJS modules
controllers
DTOs
HTTP validation
repositories
ORM entities
database migrations
PostgreSQL locking
transaction runners
AsyncLocalStorage
nestjs-cls
idempotency persistence
Redis
Outbox persistence
Kafka producers
Kafka consumers
provider integration
Saga orchestration
integration tests
```

These belong to application or infrastructure phases.

---

## 34. Domain code review checklist

### Ownership

```text
Does this behavior naturally belong to this aggregate or Value Object?
```

### Invariants

```text
Can any public method leave the object invalid?
```

### Encapsulation

```text
Can callers directly mutate important state?
```

Prefer:

```text
private mutable state
read-only access
explicit domain methods
```

### Exact arithmetic

```text
Is any financial value represented by JavaScript number?
```

If yes, reject the implementation.

### Aggregate coupling

```text
Does one aggregate accept another aggregate as a parameter?
```

If yes, verify that the operation is not application orchestration disguised as domain behavior.

### Infrastructure leakage

```text
Does the domain reference HTTP, NestJS, PostgreSQL,
ORM, Kafka, Redis, CLS, or transaction types?
```

If yes, reject the dependency.

### Shared abstractions

```text
Is this primitive genuinely shared,
or merely structurally similar to an existing type?
```

### Artificial abstractions

```text
Was this Domain Service, base class, or event framework
introduced because the business needs it,
or because a DDD template suggested it?
```

Remove abstractions without meaningful domain responsibility.

---

## 35. Definition of done

The domain phase is complete when:

```text
✓ Asset amounts use exact arithmetic

✓ WalletAccount protects all balance invariants

✓ WalletReservation has an explicit lifecycle

✓ Withdrawal has an explicit lifecycle

✓ invalid terminal-state transitions are rejected

✓ aggregate state is encapsulated

✓ creation and reconstitution are distinguished

✓ no unbounded reservation collection exists inside WalletAccount

✓ WalletReservation is modeled consistently as an Aggregate Root

✓ Withdrawal does not manipulate Wallet aggregates

✓ cross-aggregate workflow rules are not falsely modeled
  as single-aggregate invariants

✓ no repository appears in domain code

✓ no NestJS dependency appears in domain code

✓ no PostgreSQL or ORM dependency appears in domain code

✓ no Kafka or Redis dependency appears in domain code

✓ no CLS or transaction dependency appears in domain code

✓ no JavaScript floating-point financial calculation exists

✓ Domain Services exist only when justified

✓ Domain Events exist only when justified

✓ domain unit tests pass without infrastructure

✓ existing platform/shared primitives are reused where appropriate

✓ no unnecessary project-wide folder restructuring was introduced

✓ terminology is consistent with the existing codebase
```

---

## Final domain model

```text
Shared domain concepts
    Asset
    AssetAmount


Wallet model
    WalletAccount
        total balance
        reserved balance
        available balance derived

        reserve()
        releaseReserved()
        captureReserved()

    WalletReservation
        walletId
        withdrawalId
        amount
        status

        finalize()
        release()


Withdrawal model
    Withdrawal
        amount
        destination
        reservationId
        status
        provider reference

        startProcessing()
        complete()
        fail()

    WithdrawalAddress
```

The governing rule is:

> **Aggregates decide whether their own state transitions are valid. Value Objects protect exact domain values. Application workflows coordinate multiple aggregates. Infrastructure provides persistence, concurrency, messaging, and transaction execution.**

Use the existing codebase's placement conventions. Reuse platform/shared primitives when their semantics genuinely match. Do not force a new directory structure or introduce abstractions solely to make the code resemble a DDD template.
