# ADR-0004: Ledger author bake-off (Tasks 5 + 6)

- Status: Accepted
- Date: 2026-10-07

## Context
Spec §4 says a bake-off on the first ledger task picks the default author model for ledger, tax and security work. Both authors get the same spec and the same acceptance tests, and the model that passes with fewer review findings wins.

## Method
- An Opus test-designer committed the red tests on `bakeoff/base` (545c4d7). These are the plan's `validate.test.ts` and `post.test.ts` plus `validate.fx-guards.test.ts`.
- Two authors then implemented `validate.ts`, `commit.ts` and `post.ts` in separate worktrees. They worked from the interfaces, the spec and the tests. The plan's reference implementation was withheld.
- Each branch was reviewed by the other model, against spec §0 and §6 (invariants 1, 5, 7, 8, 9 and 10) and the purity rule.

## Result

| Branch | Author | Reviewer | Critical | High | Medium | Low | Tests |
|---|---|---|---|---|---|---|---|
| `bakeoff/fable` | Fable 5.1 | Opus 5.5 | 0 | 0 | 0 | 2 | 86 |
| `bakeoff/opus` | Opus 5.5 | Fable 5.1 | 0 | 0 | 0 | 3 | 104 |

- Both branches pass the spec with 100% coverage.
- Both reviewers ran the plan's Task 13 invariant properties, or an equivalent fuzz, at 2,000 runs or more. Neither found a counterexample.
- The two branches tie on critical + high + medium findings (0 each). The tie-break is total findings, 2 against 3, so **Fable 5.1 wins**.
- `bakeoff/fable` was merged into `feat/plan-01`.

## Decision
Fable 5.1 is the default author for ledger, tax and security implementation tasks. Opus 5.5 is the default reviewer of Fable-authored diffs, and the fallback author when Fable declines (spec §4).

## Consequences
- The margin is one low-severity finding, and each branch was graded by a different reviewer model. This is weak evidence. Revisit the decision if Fable-authored work draws more critical, high or medium findings than Opus-authored work over plans 02–03.
- Low findings carried forward:
  - `prepareLines` throws a TypeError, not a LedgerError, on `fxRate: null`. This is unreachable from typed callers.
  - The books Maps are mutable at runtime (`ReadonlyMap` is enforced at compile time only).
  - Neither implementation rejects a blank series. There is no error code for it yet.
  - Update: `commit` now rejects a reused `ctx.newJournalId()` with `DUPLICATE_JOURNAL_ID` (6a10a56).
