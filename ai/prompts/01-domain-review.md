# Domain review prompt

Review WalletAccount, WalletReservation, Withdrawal, WithdrawalAddress, Money, and Asset. Identify misplaced behavior, missing invariants, invalid state transitions, or coupling between domain boundaries. Do not suggest infrastructure in domain code or generic repositories.

## Outcome

Findings that survived verification against the source are recorded as
`DECISIONS.md` §7 (separate aggregate repositories), §11 (`Money` is signed and
aggregates own non-negativity — a deliberate divergence from what the review
proposed), §32 and §33 (terminal transitions emit domain events; terminality is
defined by the aggregate), and §34 (`now` is a parameter, and validate-then-swap
extended to `Withdrawal` and `WalletReservation`).
