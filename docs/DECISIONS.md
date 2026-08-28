# Engineering Decisions

## 1. Wallet is a separate domain library

Wallet and Withdrawal have separate domain ownership and Nx packages. Cross-boundary collaboration uses Withdrawal-owned capability ports and adapters at the composition root. They still share one PostgreSQL transaction today.

## 2. PostgreSQL row locking protects balances

Wallet mutation uses `SELECT ... FOR UPDATE`. In-memory or Redis locks cannot protect the source of truth across processes. Database checks provide defense in depth.

## 3. Durable idempotency with payload fingerprints

PostgreSQL owns `(operation, idempotency_key)`. Canonical request fingerprints distinguish legitimate replay from key reuse with different data. The claim occurs before Wallet locking.

## 4. Explicit TransactionRunner and AsyncLocalStorage

Application slices own transaction boundaries through a provider-neutral `TransactionRunner`. `AsyncLocalStorage` is confined to the PostgreSQL adapter and prevents transaction clients leaking into domain methods.

## 5. Modular monolith, not microservices or Saga

The required consistency fits a short local transaction. Splitting databases would add intermediate states, compensation, inbox/outbox coordination, and operational failure modes without helping this challenge.

## 6. Consumer-owned ports

Withdrawal defines separate reservation and settlement capabilities. It does not depend on Wallet repositories and no broad `WalletPort` or generic business service is introduced.

## 7. Separate aggregate repositories

`WalletAccount` does not contain reservation history. `WalletRepository` and `WalletReservationRepository` expose separate lock and persistence paths for their aggregate roots. Generic CRUD would hide those locking and transaction requirements.

## 8. Provider idempotency

The fake provider persists one result per `withdrawalId`. Repeated calls return that result. Local database deduplication alone cannot make a non-idempotent external provider exactly once; production requires provider idempotency, lookup, or reconciliation.

## 9. Relational-first storage

This is transactional OLTP with strong integrity requirements. Core state is normalized into Wallet, Reservation, Withdrawal, Idempotency, Outbox, Processed Event, and fake-provider tables. JSONB is limited to immutable response/event envelopes, not query-critical business state.

## 10. Additive aggregate-boundary migration

Migration `002_domain_aggregate_refactor.sql` backfills the reservation asset before making it required, replaces the old foreign keys with Wallet/asset and reservation/Withdrawal ownership constraints, and translates `FUNDS_RESERVED` to `PENDING`. The committed initial migration remains unchanged so existing and fresh databases follow the same history.

## 11. `Money` is signed; aggregates own non-negativity

`Money` models a signed exact quantity: `subtract` may return a negative result and `parse` accepts a leading `-`. The domain plan suggests a non-negative amount type instead, so this is a deliberate divergence.

A signed type lets `availableBalance` be a plain `balance - reserved` with no special case, and keeps `Money` a pure arithmetic value object rather than one carrying a wallet-specific rule. Non-negativity is enforced where it is actually a business rule, at three layers: the HTTP edge rejects non-positive request amounts, `WalletAccount.assertOperationAmount` rejects non-positive operands, and `WalletAccount.assertBalances` rejects negative balances on creation, reconstitution, and every mutation. Database `CHECK` constraints repeat the last of these.

## 12. Unresolved provider execution never auto-fails a Withdrawal

`Withdrawal.fail` accepts only `PROVIDER_ERROR` from `PROCESSING` — a provider that answered and rejected. When the provider call *throws* instead, the outcome is unknown: the transfer may already have happened.

`ExecuteWithdrawal` therefore wraps that throw in `WithdrawalExecutionUnresolvedError` and leaves the Withdrawal `PROCESSING` and the reservation `ACTIVE`. Kafka redelivery re-drives the idempotent provider, which is safe; releasing the reservation on an ambiguous timeout would not be, because it frees funds that may already be gone.

The residual gap is a Withdrawal stranded in `PROCESSING` once redelivery is exhausted. That needs a reconciliation sweep over stale `PROCESSING` rows plus a provider status lookup, which is follow-up work rather than something the aggregates can decide.
