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
