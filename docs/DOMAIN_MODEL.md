# Domain Model

## Wallet bounded context

`WalletAccount` is the aggregate root. It owns total balance, reserved balance, and `Reservation` entities.

Invariants:

- Reservation amount is positive.
- Available balance never becomes negative.
- Reserved balance never exceeds total balance.
- One Withdrawal can own at most one reservation.
- Only `ACTIVE` reservations may become `FINALIZED` or `RELEASED`.
- Finalization debits total and reserved balances exactly once.
- Release reduces reserved balance without changing total balance.

Reservation lifecycle:

```text
ACTIVE -> FINALIZED
ACTIVE -> RELEASED
```

## Withdrawal bounded context

`Withdrawal` is the aggregate root. It owns the provider execution lifecycle while referencing a Wallet reservation by identity.

```text
FUNDS_RESERVED -> PROCESSING -> COMPLETED
                            \-> FAILED
```

Terminal states cannot regress or repeat. `COMPLETED` requires a transaction reference; `FAILED` requires `PROVIDER_ERROR`.

The HTTP response maps internal `FUNDS_RESERVED` to external `PENDING` for compatibility.

## Shared value objects

`Asset` defines a canonical code and decimal precision. `Money` stores signed integer atomic units using `bigint`, rejects non-canonical decimal input, and prevents cross-asset arithmetic. The Wallet and Withdrawal aggregates decide where negative or zero values are invalid business operations.

Wallet and Withdrawal remain separate aggregates because their invariants and lifecycles differ. They remain in one deployment and database today because requesting a withdrawal requires strong consistency; a future service split would replace the shared transaction with a process manager and compensation.
