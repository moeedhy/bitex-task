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

## Entities

There are none below the aggregate roots.

`WalletAccount`, `WalletReservation` and `Withdrawal` are each an aggregate of
exactly one entity: their state is a flat snapshot of value objects, and every
invariant one of them owns is expressible over its own row. Nothing here is a
child entity with an identity that only means something inside a parent — the
obvious candidate, `WalletReservation`, was deliberately made a **separate root**
rather than a child of `WalletAccount`, because holding reservation history
inside the wallet would force every balance mutation to load a collection that
grows without bound (§7).

Saying so explicitly matters more than it looks: an aggregate whose root has no
children is the shape that makes single-row locking sufficient. The moment a
collection lives inside a root, the lock has to cover the collection too.

## Invariants

The brief requires nine. Each is enforced by an aggregate; the database repeats
several as a backstop against a defect in the layer above, never as the
mechanism.

| # | Invariant | Enforced by | Database backstop |
|---|---|---|---|
| 1 | Withdrawal amount > 0 | `Withdrawal.assertRequestable` (before any wallet row is touched) and `WalletAccount.assertOperationAmount` | `CHECK (amount_atomic > 0)` on `withdrawals` and `wallet_reservations` |
| 2 | Available balance never negative | `WalletAccount.assertBalances`, on creation, reconstitution and after every mutation | `CHECK (balance_atomic >= 0)` |
| 3 | Reserved never exceeds total | the same `assertBalances` — the two are one check over one candidate state | `wallets_reserved_not_above_balance` |
| 4 | One reservation per withdrawal request | `ReserveFunds` mints one reservation per withdrawal identity, created before the reservation exists | `wallet_reservations.withdrawal_id UNIQUE`, `withdrawals.reservation_id UNIQUE`, and the composite ownership FK |
| 5 | One withdrawal per Idempotency-Key | `RequestWithdrawal` claims before it reserves; `CLAIMED`/`REPLAY`/`CONFLICT` handled exhaustively | `PRIMARY KEY (operation, idempotency_key)` — the claim *is* the insert |
| 6 | A Kafka event settles at most once | `Withdrawal.isTerminal()` refuses a second settlement even under a fresh event id | `processed_events` PK on `event_id`, written in the settlement transaction |
| 7 | No regression from a terminal state | `Withdrawal.transitioned(expected, target)` throws `InvalidWithdrawalTransitionError` unless the current status is the expected source | `CHECK (status IN …)` and `withdrawals_terminal_payload_check` |
| 8 | A failed withdrawal releases its reservation | `Withdrawal.fail()` emits `WithdrawalFailed{reservationId}`; `ExecuteWithdrawal` discharges it in a `switch` closed by `assertNever` | `wallet_reservations.status` transition is written in the same transaction |
| 9 | No floating-point money | `Money` holds `bigint` atomic units and `parse` rejects non-canonical decimals; no `number` ever holds an amount | `BIGINT` columns; decimal **strings** on the wire |

Two of these are worth reading twice.

**§2 and §3 are one check, not two.** `assertBalances` validates a candidate
snapshot — `0 <= reserved <= total` — and the aggregate only swaps its state in
once that passes (validate-then-swap). A rejected `reserve` is a no-op rather
than a half-applied mutation, which is why "available never goes negative"
survives a rejected transition as well as an accepted one.

**§7 is enforced on the source, not the target.** `transitioned` names the
status the caller expects to be in. `COMPLETED → PROCESSING` fails not because
`PROCESSING` is forbidden but because the withdrawal is not `PENDING`, which is
the only form of the rule that stays correct as states are added.

Concurrency does not appear in this table because it is not a domain concern:
invariants 2, 3 and 4 hold *within* a transaction by aggregate logic, and hold
*across* concurrent transactions by the `SELECT … FOR UPDATE` in
`ReserveFunds` (`DECISIONS.md` §2). Both halves are required; neither
substitutes for the other.

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
