# Test review prompt

Challenge the test suite for happy-path bias. Find missing rollback, concurrent idempotency, payload conflict, duplicate success/failure, provider retry, transaction leakage, Redis outage, and real PostgreSQL concurrency cases. Distinguish unit tests from tests that must use infrastructure.

## Outcome

The concurrency test now asserts *which* error the losing request received —
it previously accepted any rejection, so a `lock_timeout` expiry satisfied it
identically while proving nothing about the balance invariant. Integration
specs gated on `TEST_DATABASE_URL` were made to run in CI, where they had been
reporting green while skipped. `DECISIONS.md` §48 records the migrator spec
that hardcoded three filenames instead of reading the directory.
