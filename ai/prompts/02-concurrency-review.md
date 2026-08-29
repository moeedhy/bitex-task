# Concurrency review prompt

Trace two concurrent withdrawal requests and duplicate Kafka delivery. Identify overspending, lock ordering, transaction propagation, idempotency, outbox, provider crash-window, and settlement risks. Require evidence from PostgreSQL behavior rather than in-memory locks.

## Outcome

`DECISIONS.md` §2 (why row locking rather than the three alternatives the brief
lists), §12 (an unresolved provider call never auto-fails a withdrawal), §24
(every money-bearing `UPDATE` asserts it matched a row — three did not), §25
(the wallet → reservation → withdrawal lock hierarchy, which settlement was
violating in the opposite order), and §26 (recovery claims rows rather than
reading them, which had been re-publishing a stranded withdrawal from every
replica on every cycle without bound). §3 records the `FOR UPDATE` that was
removed from the idempotency replay read for making retry storms worse.
