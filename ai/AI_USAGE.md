# AI Usage

- Tools: OpenAI Codex, then Claude Code for the architecture review and refactor
  documented in `docs/plans/REFACTOR_PLAN.md`. The repository carries config for
  both (`.codex/`, `AGENTS.md`, `.claude/`, `CLAUDE.md`), and commits from the
  refactor are attributed in their trailers.
- Helped with: aggregate review, concurrency/transaction analysis, idempotency crash windows, test case enumeration, and implementation scaffolding.
- Accepted suggestion: create the Withdrawal identity before Wallet reservation and enforce `UNIQUE(withdrawal_id)` on reservations.
- Modified suggestion: the original combined-context plan was adapted to a separate Wallet bounded-context library while retaining one PostgreSQL transaction through composition-root adapters.
- Rejected suggestion: no Saga or microservice split was introduced because both contexts share one source-of-truth database.
- Verification: domain behavior is unit tested; transaction context is tested; PostgreSQL integration tests exercise real row locks and simultaneous idempotent requests; Nx build, lint, typecheck, and tests are the final gates.
- Second pass: a multi-agent review against twelve criteria — DDD, hexagonal
  boundaries, vertical slices, cognitive complexity and load, LCOM, the brief's
  own requirements, YAGNI, KISS, SOLID, developer experience, change
  amplification, and the DI system — followed by the phased refactor in
  `docs/plans/REFACTOR_PLAN.md`. The review found seven correctness defects in
  code that already passed its own tests, including a shutdown-phase inversion
  that ended the connection pool while the HTTP server was still accepting, and
  three money-bearing `UPDATE`s that never checked whether they matched a row.
- Judgement retained: every finding was verified against the source before being
  acted on, every regression test was proved by reverting its fix and watching
  the test fail, and one plan-level claim (that a missing `uuid` dependency would
  break the container) was tested, found false, and corrected in
  `docs/DECISIONS.md` §30 rather than shipped.
