# ZamBooks Roadmap and Multi-Agent Orchestration

**Spec:** `md files/ZamBooks working.md` (copied to `/CLAUDE.md` in Task 11 of plan 01)

The spec spans six phases and about 15 independent subsystems. One plan cannot hold them all. This file has two jobs:
1. It splits the spec into sub-plans. Each sub-plan ships working, tested software on its own.
2. It defines how multiple Claude Code agents run those plans: the agent roles, model routing, parallel waves, the review protocol and the human gates.

Only plan 01 is written in full (`2026-10-07-zambooks-01-foundation-and-ledger-core.md`). Each later plan is written when the plan before it is merged, because its interfaces depend on code that does not exist yet.

---

## 1. Sub-plan sequence

| # | Plan | Spec § | Depends on | Parallelisable with |
|---|---|---|---|---|
| 01 | Foundation + pure ledger core (monorepo, CI, Money/FX, domain model, posting engine, reversals, periods, number series, TB, CoA template, invariants 1–3, 5–10, 12 (domain level), property tests, `.claude` config) | 0, 1 (domain half), 6, 13 | — | — |
| 02 | Persistence + tenancy: Postgres 16, Drizzle migrations, RLS, gapless series under concurrency, Testcontainers, invariant 12 at DB level | 1 | 01 | 03 |
| 03 | Identity + audit: OIDC, RBAC, SoD, MFA for privileged roles, hash-chained append-only audit log | 1, 8 | 01 | 02 |
| 04 | API shell: Fastify + Zod + OpenAPI, contract tests, rate limiting, seeded demo company that balances | 1 | 02, 03 | — |
| 05 | Web shell: Vite/React/TanStack/shadcn, auth flow, CoA + journal + TB screens, axe, Playwright | 2 (UI) | 04 | 06 |
| 06 | Sales/AR sub-ledger (invoice → receipt, credit notes, statements, ageing, credit limits; invariant 4) | 2 | 04 | 07, 08 |
| 07 | Purchases/AP (PO → GRN → invoice → 3-way match → payment) | 2 | 04 | 06, 08 |
| 08 | Inventory (movements, FIFO/WAC per ADR, counts; invariant 11) | 2 | 04 | 06, 07 |
| 09 | Bank + mobile money import and reconciliation (CSV/OFX/MT940; MTN/Airtel **blocked until provider APIs are confirmed**) | 2 | 06, 07 | 10 |
| 10 | Reporting engine: server-side PDF, ExcelJS, golden-file snapshots (TB, P&L, BS) | 3, 9 | 04 | 09 |
| 11 | `tax-zm` VAT + Smart Invoice (**blocked on the ZRA spec/sandbox and accountant**) | 3 | 06, 07, 10 | 12 |
| 12 | Payroll (PAYE, NAPSA, NHIMA, SDL, workers' compensation) (**blocked on accountant-verified rates**) | 3 | 04, 10 | 11 |
| 13 | WHT, turnover tax, provisional tax, fixed assets, IFRS for SMEs statements, BoZ rates | 3 | 10, 11 | — |
| 14 | FX revaluation, multi-company, intercompany, consolidation | 4 | 06–08 | 15 |
| 15 | Budgets, cash-flow statement, dashboards, scheduled reports | 4 | 10 | 14 |
| 16 | Approval workflows, OCR capture, public API + webhooks, auditor portal, backup/PITR, exit export | 5 | 04+ | split per feature |

Every rate, threshold and filing rule in plans 11–13 starts as a `VERIFY` entry in the compliance register. No agent marks an entry `VERIFIED`.

---

## 2. Agent topology

The orchestrator is the main Claude Code session. It owns the plan, dispatches the agents, merges worktrees and talks to you. It does not write production code for Opus-class tasks itself, because the author and the reviewer must be different models.

| Role | Implemented as | Default model | Writes code? |
|---|---|---|---|
| Orchestrator | main session | Opus 5.5 | glue only (merges, plan ticks) |
| `test-designer` | `.claude/agents/test-designer.md` | opus | tests only, committed red |
| Author (ledger/tax/security/migrations) | general-purpose agent in a worktree | opus **or** fable (bake-off winner) | implementation only, never edits tests |
| Author (UI/API/importers/e2e) | general-purpose agent in a worktree | sonnet | yes |
| Author (fixtures/seed/i18n/docs) | general-purpose agent | haiku | yes |
| `ledger-reviewer` | `.claude/agents/ledger-reviewer.md` | opposite of the author (fable ↔ opus) | no, findings only |
| `tax-auditor` | `.claude/agents/tax-auditor.md` | opus (fable if the author was opus) | no |
| `security-reviewer` | `.claude/agents/security-reviewer.md` | fable, falling back to opus if it refuses | no |
| `data-migrator` | `.claude/agents/data-migrator.md` | sonnet | importers and migrations, plans 02/09 |

**Model-name note:** the spec routes UI work to "Sonnet 5.5 / `claude-sonnet-5-5`". No such model exists today. The current model is **Sonnet 5** (`claude-sonnet-5`). The plans use `sonnet` and assume Sonnet 5 until the spec is corrected.

**The red-green split is the core multi-agent pattern.** For every task:
```
test-designer (opus)  ──writes failing tests, commits RED──▶
author (worktree)     ──implements until GREEN, may not touch *.test.ts──▶
reviewer (≠ author)   ──checks diff against §6 / §8, returns findings──▶
author fixes (≤ 3 rounds, then escalate to human) ──▶ orchestrator merges
```
This makes "tests first" enforceable by construction rather than by trust. An author who edits a test file fails review automatically.

---

## 3. Execution waves for plan 01

Tasks are in `2026-10-07-zambooks-01-foundation-and-ledger-core.md`.

```
Wave A (serial, orchestrator) : T1 scaffold + git + CI
Wave B (parallel, 3 worktrees): T2 Money        | T10 .claude agents/hooks | T11 docs/ADR/register
Wave C (serial)               : T3 FX conversion
Wave D (serial)               : T4 domain model + errors
Wave E (BAKE-OFF)             : T5 journal validation + T6 posting engine
                                 test-designer writes the T5+T6 tests once (red)
                                 ├─ worktree opus-author  → implements
                                 └─ worktree fable-author → implements
                                 each reviewed by the other model; fewer findings wins (spec §4)
Wave F (parallel, 3 worktrees): T7 reversals | T8 periods | T9 CoA template
Wave G (serial)               : T12 trial balance + BS identity + sub-ledger reconciliation
Wave H (serial)               : T13 property-based invariant suite (fast-check)
Wave I                        : whole-branch review (fable if most authors were opus) → human
```

Why the waves look like this:
- T2, T10 and T11 touch disjoint files, so they can run in parallel safely.
- T3–T6 form a dependency chain on interfaces (Money → FxRate → domain types → `post`). Running them in parallel would mean guessing interfaces.
- T7, T8 and T9 all consume `post`/`commit` from T6 but write separate files, so they can run in parallel. The orchestrator merges `index.ts` exports by hand.

**Plans 02 + 03 run in parallel** (DB versus identity/audit) once 01 merges. **Plans 06, 07 and 08 run in parallel**, which is the biggest fan-out (3 Sonnet authors plus 1 Opus test-designer each).

---

## 4. Review protocol (every task)

1. The reviewer receives: the task text from the plan, the spec §6 and §8, and `git diff main...<branch>`.
2. The reviewer returns findings as `{severity: critical|high|medium|low, file:line, invariant, scenario}`.
3. Critical or high findings block the merge. Medium findings are fixed or logged in the PR. Low findings are optional.
4. After 3 rounds, an unresolved critical or high finding stops the work and goes to you.
5. The orchestrator runs the verification gate itself before merging (`pnpm typecheck && pnpm lint && pnpm test && pnpm test:invariants`). It never trusts an agent's "tests pass" claim.

## 5. Human gates and decisions needed before or during the build

| When | Decision / gate | Default if you don't object |
|---|---|---|
| Before plan 01 | Backend framework and ORM (spec offers NestJS/Fastify and Drizzle/Prisma) | Fastify + Drizzle (ADR-0002) |
| Before plan 01 | FX rounding mode | Banker's rounding (half-even), marked `VERIFY` (ZM-0002) |
| Before plan 01 | Where is the React prototype (`ZambianERPSystem`)? | Not found on this machine; it is reference only, so not blocking |
| Before plan 03 | OIDC provider (Keycloak / Auth0 / Supabase Auth) | ask then |
| Before plan 11/12 | Named ZICA/ACCA accountant for `verified_by` | blocking for production, not for building |
| Before plan 11 | ZRA Smart Invoice mandate, scope and sandbox credentials | blocking |
| Before plan 09 | MTN/Airtel API access and fees | blocking for the mobile-money half only |
| Pre-launch | Spec §12 release gates 1–8 | human only |
