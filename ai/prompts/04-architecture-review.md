# Architecture review prompt

Used as a multi-agent pass: one agent per criterion, each reading the source
directly rather than the documentation, then a merge that kept only findings
reproducible from the code.

Review this workspace against twelve criteria, separately, and report each
finding with the file and line that proves it:

1. **DDD** — is behaviour in the aggregates, or in application services wearing
   a domain folder name?
2. **Hexagonal boundaries** — does anything in `domain/` or `application/`
   import a framework, driver, or ORM type?
3. **Vertical slices** — does one use case live in one folder, or is it spread
   across layers by technical role?
4. **Cognitive complexity** — which function requires holding the most
   simultaneous state to read?
5. **Cognitive load** — how many files must be opened to answer "what happens
   when a withdrawal fails"?
6. **LCOM** — which class has methods that share no fields, and should be two?
7. **The brief's own requirements** — walk `docs/TASK.md` §1-§19 and name each
   requirement that is claimed but not implemented, or implemented but not
   demonstrated by a test.
8. **YAGNI** — what exists that nothing calls?
9. **KISS** — where is the simple version rejected without a stated reason?
10. **SOLID** — specifically: which dependency points at a concrete class where
    an interface exists?
11. **Developer experience** — what fails at runtime that could fail at compile
    time instead?
12. **Change amplification** — what single behavioural change requires editing
    more than three files, and why?

Rules: no finding without a file and line. Do not trust a comment, a doc, or a
test name — read what the code does. Where you assert a defect, state the input
that triggers it and the observable wrong outcome. Distinguish "this is wrong"
from "I would have written it differently", and drop the second category.
