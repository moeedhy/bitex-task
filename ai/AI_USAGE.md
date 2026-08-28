# AI Usage

- Tool: OpenAI Codex.
- Helped with: aggregate review, concurrency/transaction analysis, idempotency crash windows, test case enumeration, and implementation scaffolding.
- Accepted suggestion: create the Withdrawal identity before Wallet reservation and enforce `UNIQUE(withdrawal_id)` on reservations.
- Modified suggestion: the original combined-context plan was adapted to a separate Wallet bounded-context library while retaining one PostgreSQL transaction through composition-root adapters.
- Rejected suggestion: no Saga or microservice split was introduced because both contexts share one source-of-truth database.
- Verification: domain behavior is unit tested; transaction context is tested; PostgreSQL integration tests exercise real row locks and simultaneous idempotent requests; Nx build, lint, typecheck, and tests are the final gates.
