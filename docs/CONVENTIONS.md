# Conventions

The rules this codebase actually follows. Most of them are enforced by
`lint` or `typecheck` rather than by review; where that is true, it says so.

The test for a convention here is not "is it tidy" but "does breaking it fail
the build, and if not, why is it still worth writing down".

---

## Identity

Every identifier is `Uuid<'Name'>` from `libs/platform/src/identity` — a
`string` at runtime, a distinct type at compile time.

```ts
export type WithdrawalId = Uuid<'WithdrawalId'>;
export const WithdrawalId = identity('WithdrawalId');   // merged type and parser
```

- **Minted** only through an `IdGenerator<Name>`, which is typed by what it
  produces. An `IdGenerator<'EventId'>` cannot be injected where withdrawal ids
  are expected.
- **Parsed** at system edges — an HTTP path parameter, a Kafka payload, a
  database row — through `WithdrawalId.parse(raw)`. That is the *only* way to
  obtain one, which is why aggregates do not re-check identities they cannot be
  handed unparsed.
- **Cross-context** identities (`UserId`, `WithdrawalId`, `ReservationId`,
  `EventId`) live in platform. Context-private ones (`WalletId`) live in the
  library that owns the aggregate.
- Validation matches the RFC 4122 *layout*, not version 7: new ids are UUIDv7
  for index locality, but older rows hold v4 and are still valid identities.

Enforced by `typecheck`. See `DECISIONS.md` §27.

## Use cases

One class per slice, in `application/<slice>/`:

```text
application/request-withdrawal/
  request-withdrawal.ts            the use case
  request-withdrawal.contract.ts   XCommand and XResult
  request-fingerprint.ts           slice-private policy
  request-withdrawal.spec.ts
```

- `execute(command: XCommand): Promise<XResult>` — no positional string
  parameters, no anonymous inline input types.
- Dependencies arrive as one `XDependencies` object, destructured in the
  constructor. Which shape a use case takes is not a matter of taste per slice.
- Failures throw. The one Result-shaped return is `IdempotencyClaim`, because
  `CONFLICT` is a protocol outcome rather than a failure; its justification is
  in `DECISIONS.md` §14.

## Ports

All in `application/ports/`, one per file, never declared inside a use-case
file. Suffixed by role:

| Suffix | Meaning |
|---|---|
| `*Repository` | aggregate persistence |
| `*Query` / `*QueryPort` | a read model, served without a row lock |
| `*Port` | a consumer-owned capability, satisfied at the composition root |

A port must be narrow enough that no test double needs a
`throw new Error('not used')` stub. Where a repository is wider than any one
caller, derive the narrow views rather than restating them:

```ts
export type WithdrawalAppender = Pick<WithdrawalRepository, 'add'>;
export type WithdrawalMutator  = Pick<WithdrawalRepository, 'getForUpdate' | 'save'>;
```

Semantics that every implementation must honour — the idempotency port's
`CLAIMED`/`REPLAY`/`CONFLICT` concurrency contract, for instance — are
documented on the *port*, not on whichever adapter happens to implement it
today.

## Errors

Every failure extends `CodedError`:

```ts
export class WalletNotFoundError extends CodedError {
  readonly code = 'WALLET_NOT_FOUND' as const;
}
```

- `code` is the stable identifier and part of the public contract. Messages are
  for humans and change freely.
- `retryable` defaults to `false`, because domain and application failures are
  deterministic. Anything that is *not* a `CodedError` is treated as retryable:
  a driver timeout or a socket reset carries no verdict.
- `name` is derived from the class. Do not restate it.
- Each library exports a union of its own codes, written against the error
  *classes* so it cannot drift:

```ts
export type WalletDomainErrorCode = ErrorCodeOf<
  typeof WalletNotFoundError | typeof InsufficientAvailableBalanceError | …
>;
```

The HTTP layer composes those unions and maps them with
`Record<ApiErrorCode, HttpStatus>`, so an unmapped code is a **compile error**.

Domain errors live with their aggregate; application errors live at
`application/`, because they are protocol rather than rule (`DECISIONS.md` §38).

## Integration contracts

Owned by the **producing** context, in `src/contracts/`. One module exposes the
schema, a `build()` derived from the aggregate's domain event, and a `parse()`.
Producer and consumer both import it, so they cannot drift.

- `z.object`, never `z.strictObject`. An additive producer change must not
  dead-letter every consumer that has not been redeployed.
- An explicit `schemaVersion` carries the breaking change instead, defaulting to
  the current version when absent so a rolling deploy does not strand a backlog.
- Amounts cross the wire as **decimal strings**. `100.000001` USDT does not
  survive an IEEE-754 double.

## Domain

- Aggregates expose behaviour, not setters. `toSnapshot()` is for persistence.
- **Validate then swap**: build the candidate state, assert every invariant,
  then assign. A rejected transition must be a no-op, not a half-change.
- `now` is a required parameter. A `= new Date()` default puts an ambient clock
  inside the domain and lets callers bypass the injected `Clock`.
- Status vocabularies are `as const` arrays with the union derived from them, so
  the type and its runtime guard cannot drift.
- Exhaustive `switch` with `assertNever` over any union the domain owns.
- **Obligations travel as domain events.** A terminal transition that leaves
  someone else work to do emits an event naming what it left — see
  `WithdrawalFailed{reservationId}` and `DECISIONS.md` §32.

## Dependency injection

- `libs/*/src/nest/` and nowhere else may import `@nestjs/common`. The domain
  and application layers are framework-free, and that is checked by
  `@nx/enforce-module-boundaries` plus the fact that Nest is a *peer*
  dependency.
- Tokens, never concrete classes:
  `export const WALLET_REPOSITORY = token<WalletRepository>('WalletRepository')`.
  A class used as a token makes the binding unoverridable in a test.
- Wire with `provide(target, deps, factory)`, which type-checks the factory
  against its `inject` list. Nest's own `useFactory` correlates two positional
  lists by hand.
- A library module is a `DynamicModule` with `forRoot({ imports })`. It declares
  the tokens it needs and exports only use cases; the application binds adapters.
  Call `forRoot` **once** and re-export the result.

## Configuration

One zod-validated `AppConfig`, parsed at composition. No `process.env` outside
`app-config.ts` — a read inside a `@Module` decorator runs at import time,
before a test can set it. Every variable belongs in `.env.example`.

## Presentation

`apps/api/src/http/dto/` holds request and response DTOs with explicit mappers.
Controllers never return an application result verbatim: doing so makes every
one of its fields a published API field by default.

Where a value is also persisted — the idempotent response payload — it gets a
third, versioned type. Three roles, three types (`DECISIONS.md` §45).

## Files and modules

- kebab-case, with a role suffix where a role exists: `.repository.ts`,
  `.port.ts`, `.contract.ts`, `.errors.ts`, `.module.ts`, `.tokens.ts`.
- Adapters are prefixed by technology: `postgres-`, `kafka-`, `redis-`.
- **Barrels list explicit names — never `export *`.** A star export publishes
  whatever a file happens to declare; that is how `createRequestFingerprint`,
  the policy `DECISIONS.md` §14 argues must not be reproducible outside its
  workflow, became part of the public contract.

## Tests

- Jest everywhere, `*.spec.ts` beside the code under test.
- Integration specs are gated on `TEST_DATABASE_URL` and **run in CI**, which is
  the point: before that, `nx run-many -t test` reported green with the
  concurrency test skipped.
- Prove a regression test by making it fail. A test never observed failing is a
  hypothesis.
- Assert *why*, not only *that*. A concurrency test that accepts any rejection
  passes on a `lock_timeout` as happily as on the business rule it means to
  check.
- Fakes describe the dependency, not the assertion. Record the arguments a
  collaborator received when the point is *which* one it was given.

## Adding a use case

1. `application/<slice>/<slice>.contract.ts` — `XCommand`, `XResult`.
2. `application/<slice>/<slice>.ts` — the class, dependencies as one object.
3. Any new port in `application/ports/`.
4. A token per port in `src/nest/*.tokens.ts`, and a `provide(...)` in the
   module.
5. Bind the adapters in `apps/api/src/modules/`.
6. `<slice>.spec.ts`.

Steps 4 and 5 are where the compiler helps: a missing binding is a container
error naming the token, and a mis-ordered factory is a type error.
