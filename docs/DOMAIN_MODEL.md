# Domain Model

## Wallet domain boundary

`WalletAccount` and `WalletReservation` are separate aggregate roots.

`WalletAccount` owns only balance state and exposes `reserve`, `releaseReserved`, and `captureReserved`. Available balance is derived from total minus reserved balance. The aggregate validates `0 <= reserved <= total` on creation, reconstitution, and after every mutation. It never loads reservation history.

`WalletReservation` owns one reservation identity, its Wallet and Withdrawal references, exact amount, and lifecycle:

```text
ACTIVE -> FINALIZED
ACTIVE -> RELEASED
```

Terminal reservations cannot transition again. The application layer coordinates reservation lifecycle and Wallet balance mutations in one transaction. The database uniquely enforces one reservation per Withdrawal.

## Withdrawal domain boundary

`Withdrawal` owns the provider execution lifecycle and references a Wallet reservation by identity. Its asset is derived from the amount rather than stored alongside it, so the two cannot disagree.

```text
PENDING -> PROCESSING -> COMPLETED
                     \-> FAILED
```

The challenge suggests a five-state model including `FUNDS_RESERVED`. This model
collapses it to four deliberately: funds are reserved inside the same
transaction that creates the Withdrawal, so a Withdrawal can never be observed
before its reservation exists. A separate `FUNDS_RESERVED` state would therefore
be unreachable by any reader — `PENDING` already means *created and funded,
awaiting execution*. Modelling a state no observer can distinguish would add a
transition to test and maintain without adding information.

Terminal states cannot regress or repeat. `COMPLETED` requires a provider transaction reference; `FAILED` requires `PROVIDER_ERROR`. Creation and persisted-state reconstitution both validate the aggregate.

`WithdrawalAddress` is an immutable value object. It rejects blank or oversized destinations, normalizes on creation, and rejects a persisted value that is not already normalized, since that signals a persistence defect rather than untrusted input. It deliberately avoids blockchain-specific validation because blockchain integration is out of scope.

## Shared value objects

`Asset` defines a canonical code and decimal precision. `Money` stores exact integer atomic units using `bigint`, rejects non-canonical decimal input, and prevents cross-asset arithmetic. Wallet and Withdrawal decide where negative or zero values are invalid business operations.

Wallet and Withdrawal are deployed together because requesting a Withdrawal requires strong consistency. A future database/service split would need a process manager and compensation rather than pretending the current local transaction can cross that boundary.

## Identity

Every identifier is a branded UUID: `WithdrawalId`, `ReservationId`, `UserId`,
`EventId` in `libs/platform`, and the context-private `WalletId` in
`libs/wallet`. They are `string` at runtime and mutually unassignable at compile
time, so `settle(reservationId, withdrawalId)` cannot be called with its
arguments swapped.

The type is unforgeable outside `parse()`, which is what allows the aggregates to
stop checking their own identities. Each of `WalletAccount`, `WalletReservation`
and `Withdrawal` previously carried a private `assertIdentity` — the same
non-blank test, throwing two different error types, accepting `'wallet-!!!'` as
a valid wallet id. The check now happens once, where a raw string crosses into
the system: an HTTP path parameter, a Kafka payload, a database row.

New identifiers are UUIDv7. The leading 48 bits are a millisecond timestamp, so
generated keys are monotonically increasing: inserts stay on the right-hand edge
of the primary key's B-tree instead of scattering across it, and `ORDER BY id` is
a usable proxy for creation order. Validation accepts any RFC 4122 layout, since
rows written before that change hold v4 values and are still valid identities.

`userId` is branded too, which deviates from the brief's `"userId": "user-123"`
examples — see `DECISIONS.md` §27 for the trade and the one-file reversal.

## Domain events

A terminal transition that leaves someone else work to do says so, and names
what it left:

| Emitted by | Event | Carries | Obligation it creates |
|---|---|---|---|
| `Withdrawal.request()` | `WithdrawalExecutionRequested` | withdrawal, user, asset, amount | publish the execution intent |
| `Withdrawal.complete()` | `WithdrawalCompleted` | withdrawal, **reservationId**, provider reference | capture the reserved funds |
| `Withdrawal.fail()` | `WithdrawalFailed` | withdrawal, **reservationId**, reason | release the reserved funds |

`pullDomainEvents()` drains them; the caller acts on each exactly once, inside
the transaction that persists the state change that produced it.

This is how invariant §5.8 of the brief — *a failed withdrawal must release its
reservation* — stops being an `if`/`else` in an application service. It was true
there only because one method happened to be written correctly, and adding a
fifth status meant remembering to extend it. Now the aggregate states the
obligation together with the reservation it concerns, and `ExecuteWithdrawal`
discharges it in a `switch` that `assertNever` makes exhaustive: a new terminal
state cannot be added without deciding what becomes of the reserved funds.

These are *domain* events, not the wire format. They carry `Money` and `Asset`
rather than decimal strings, and nothing outside `libs/withdrawal` sees them. The
integration event published to Kafka is derived from
`WithdrawalExecutionRequested` by `src/contracts/`, which is the only place the
two shapes meet.

`Withdrawal.isTerminal()` is the single definition of terminality. It replaced
two literal `status === 'COMPLETED' || status === 'FAILED'` comparisons in the
application layer — the rule stated outside the aggregate that owns it, twice,
where forgetting one re-settles a finished withdrawal.
