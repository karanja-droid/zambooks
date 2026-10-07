# CLAUDE.md — ZamBooks (working name): Accounting & ERP for Zambian SMEs

## 0. GOVERNING INSTRUCTION

Build a multi-tenant SaaS accounting system for Zambian SMEs. It is correct before it is complete, and auditable before it is fast.

**Non-negotiables:**
1. A double-entry ledger is the single source of truth. Balances are always derived, never typed in.
2. Tests are written before implementation. No feature merges with a red suite.
3. Money is never a float. Use integer minor units or a decimal type.
4. Nothing financial is hard-deleted. Void or reverse instead.
5. Tax rates, thresholds and statutory rules live in versioned data, never in code. Every value is marked `VERIFY` until a Zambian accountant has signed it off.
6. Never claim "ACCA-approved", "ZRA-approved" or "tested" unless a named external party has confirmed it in writing.

## 1. CONTEXT (SCQA)

- **Situation:** A React prototype exists (multi-company, multi-currency, CRUD screens). Balances are in-memory and typed-in.
- **Complication:** Nothing posts to a ledger. The seed data does not balance. There is no persistence, auth, audit trail or real PDF/CSV reporting. Modals and several modules are unwired.
- **Question:** How do we reach a production-grade, compliant, multi-tenant SaaS?
- **Answer:** Rebuild on a proper stack with the ledger first. Port UI from the prototype only after the domain layer is proven by tests.

## 2. STACK (default, override only with a written ADR)

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict), Node 22 LTS | End-to-end typing |
| Monorepo | pnpm + Turborepo | `apps/web`, `apps/api`, `packages/ledger`, `packages/tax-zm`, `packages/shared` |
| Frontend | React + Vite, TanStack Query/Table, Tailwind (static classes only, no dynamic class strings), shadcn/ui | |
| Backend | NestJS or Fastify + Zod validation | OpenAPI generated from schemas |
| DB | PostgreSQL 16 | Row-level security (RLS) for tenancy; `NUMERIC(19,4)` or integer minor units |
| ORM/migrations | Drizzle or Prisma + SQL migrations | Reviewed migrations only |
| Auth | OIDC provider (Keycloak/Auth0/Supabase Auth) | MFA mandatory for admin/approver roles |
| Jobs/queue | BullMQ + Redis | Imports, report rendering, FX rate sync |
| PDF | Server-side (Playwright/Chromium or React-PDF) | Never `window.print()` |
| CSV/XLSX | Papaparse (parse), ExcelJS (export) | Preview, map, dry-run, error report |
| Storage | S3-compatible, encrypted, versioned | Document attachments |
| Observability | OpenTelemetry, Sentry, structured logs | No PII or financial amounts in logs |
| Infra | Docker, Terraform, GitHub Actions | Staging and prod separated |
| Money | `dinero.js` or `decimal.js` wrapper in `packages/shared` | A lint rule bans `number` arithmetic on money |

## 3. THE LOOP (follow for every task)

````text
1. READ     Read this file, the relevant ADRs, and existing tests.
2. PLAN     Write a short plan: scope, invariants affected, files touched, risks. Opus-tier model for ledger/tax/security tasks.
3. TEST     Write failing tests first (unit, property-based, e2e as relevant). Commit them red.
4. BUILD    Implement the minimum to pass. Sonnet-tier for UI/API; Haiku-tier for boilerplate.
5. VERIFY   Run: typecheck, lint, unit, property, integration, e2e, migration up/down.
6. REVIEW   A DIFFERENT model than the author reviews the diff against §6 invariants and §8 security checklist.
7. FIX      Address findings; re-run step 5. Max 3 review iterations, then escalate to the human.
8. RECORD   Update CHANGELOG, ADR if a decision was made, and the compliance register if a rule changed.
9. COMMIT   Conventional commit, one logical change, PR with the checklist in §11.
````

**Loop rules:**
- Never mark a task done on "it compiles". Done means the §11 Definition of Done is met.
- If tests contradict the spec, stop and ask. Do not edit the tests to pass.
- If a statutory rule is unclear, add a `VERIFY` entry to `docs/compliance/register.md` and stop. Do not guess.
- Report failures plainly. Never describe unrun tests as passed.

## 4. MODEL ROUTING (Claude Code)

| Task class | Model | String |
|---|---|---|
| Ledger design, tax engine, FX revaluation, consolidation, security review, test design, migrations | Opus 5.5 (Fable 5.1 where available) | `claude-opus-5-5` |
| UI, forms, API endpoints, importers, report templates, e2e tests | Sonnet 5.5 | `claude-sonnet-5-5` |
| Fixtures, seed data, lint fixes, i18n strings, docs formatting | Haiku 4.5 | `claude-haiku-4-5-20251001` |

**Rules:**
- Author and reviewer must be different models.
- A bake-off on the first ledger task decides the author for that class. Same spec, same acceptance tests, and the model that passes with fewer review findings wins.
- Fable 5.1 carries extra cybersecurity safeguards and may be more conservative on security-testing work. Use Opus 5.5 as the fallback.

## 5. SUBAGENTS AND HOOKS (Claude Code configuration)

**Subagents** (`.claude/agents/`):
- `ledger-reviewer`: checks every diff against §6.
- `tax-auditor`: checks tax logic against `docs/compliance/register.md`; refuses unverified rates.
- `security-reviewer`: runs the §8 checklist, threat-models new endpoints.
- `test-designer`: writes property-based and edge-case tests from the spec.
- `data-migrator`: owns CSV import mappings and migration scripts.

**Hooks** (`.claude/settings.json`):
- PreToolUse: block edits to `migrations/applied/**` and `packages/tax-zm/rates/**` unless the task references a register entry.
- PostToolUse: run typecheck and lint on changed files.
- Stop: run the full unit and invariant suite and refuse to finish on red.

**Slash commands:** `/plan`, `/invariants` (run the §6 suite), `/review` (cross-model), `/compliance-check`, `/release-gate`.

## 6. LEDGER INVARIANTS (property-tested, must always hold)

1. Every journal balances: Σ debits = Σ credits, in transaction currency and in functional currency.
2. The trial balance of any company at any date nets to zero.
3. Balance sheet identity: Assets = Liabilities + Equity, always.
4. AR and AP sub-ledgers reconcile to their control accounts at all times.
5. Posted journals are immutable. Corrections are reversal journals linked to the original.
6. Closed periods reject postings. Reopening requires a privileged role and an audit entry.
7. Journal numbers are gapless per company and per series.
8. Every journal line references an account ID (never a name), has a company ID, and has an author and timestamp.
9. FX: each line stores the transaction currency amount, the rate used, the rate source and date, and the functional amount.
10. Rounding differences post to a designated rounding account, never silently.
11. Inventory valuation (FIFO or weighted average, per policy) reconciles to the stock control account.
12. Cross-tenant reads and writes are impossible, proven by tests that attempt them.

## 7. FUNCTIONAL SCOPE

### Phase 0: Foundation (blocks everything)
- Monorepo, CI, lint/type/test gates, ADR process, `VERIFY` register.
- Chart of accounts templates (Zambian SME default, IFRS for SMEs mapping).
- Domain model: Company, Period, Account, Journal, JournalLine, Currency, FxRate, Party.

### Phase 1: Core ledger and persistence
- Double-entry posting engine, reversals, period management, number series.
- Postgres with RLS, auth, RBAC, immutable audit log (append-only, hash-chained).
- Seed demo company that balances, verified by test.

### Phase 2: Sub-ledgers and documents
- Sales: quotes, invoices, credit notes, receipts, customer statements, AR ageing, credit limits.
- Purchases: POs, GRN, supplier invoices, 3-way match, payments, AP ageing.
- Inventory: items, movements, stock valuation, reorder alerts, stock counts and adjustments.
- Bank: statement import (CSV/OFX/MT940), rules-based matching, reconciliation.
- Mobile money: MTN/Airtel collection and payment capture and reconciliation (confirm provider APIs and fees).

### Phase 3: Compliance (Zambia)
All rates, thresholds and filing rules live in `packages/tax-zm/rates/*.json`, versioned by effective date, each with a source citation and a `verified_by` field. **Confirm current values with ZRA/Finance Act guidance and the accountant; do not rely on model memory.**
- **VAT:** output/input VAT, standard/zero-rated/exempt, return workings, reverse charge on imported services, VAT reconciliation to ledger.
- **ZRA Smart Invoice:** integration per the current ZRA spec and sandbox. Confirm the mandate, scope and API before building.
- **Payroll:** PAYE, NAPSA, NHIMA, Skills Development Levy, workers' compensation; payslips, P-returns, statutory remittance reports.
- **Other taxes:** withholding tax, turnover tax, provisional income tax workings.
- **Statutory reporting:** IFRS for SMEs statements with comparatives and notes; fixed-asset register and depreciation; tax computation schedule.
- **Currency:** Bank of Zambia rate import, with checks on Kwacha pricing rules for domestic invoices.

### Phase 4: Multi-currency, groups, analytics
- FX revaluation, realised and unrealised gains and losses.
- Multi-company with intercompany transactions, eliminations, currency translation, consolidation.
- Budgets vs actuals, cash-flow statement (direct and indirect), KPI dashboards, scheduled reports.
- Other jurisdictions are separate tax packs (e.g. Kenya eTIMS, South Africa), added only after Zambia is stable.

### Phase 5: Platform and enterprise features
- Approval workflows with maker-checker and configurable limits.
- Document attachments with OCR-assisted capture (human confirms before posting).
- Public API with scoped keys, webhooks, and a rate-limited sandbox.
- Accountant/auditor read-only portal and an export pack (trial balance, GL, sub-ledgers, audit trail).
- Backup, point-in-time recovery, data export on exit, and a tenant deletion policy.

## 8. SECURITY AND PRIVACY CHECKLIST (run on every PR touching auth, data or API)

- Tenancy enforced by Postgres RLS, not only application code. Tests attempt cross-tenant access.
- RBAC with segregation of duties: the creator of a payment cannot approve it; the poster of a journal cannot reverse it without a second approver.
- MFA for privileged roles; session management and rate limiting.
- Input validation with Zod on every endpoint; parameterised queries only.
- CSV import: size limits, MIME and content checks, row caps, and formula-injection sanitising on both import and export.
- Secrets in a vault, never in the repo; dependency and container scanning in CI (SAST, SCA, secret scan).
- Encryption in transit and at rest; field-level encryption for bank details and national IDs.
- No PII or amounts in logs. Audit log is append-only and hash-chained.
- Compliance with Zambia's Data Protection Act 2021 (confirm current obligations and registration requirements with counsel).
- Threat model updated for each new external integration.

## 9. TESTING STRATEGY

| Layer | Tooling | Requirement |
|---|---|---|
| Unit | Vitest | Domain code ≥ 90% line and branch coverage; ledger and tax packages 100% on posting paths |
| Property-based | fast-check | Run §6 invariants over thousands of random journals, including multi-currency and rounding |
| Integration | Testcontainers (real Postgres) | Migrations up/down, RLS, posting transactions, concurrency |
| Contract | OpenAPI schema tests | No breaking API changes without a version bump |
| E2E | Playwright | Invoice to receipt, PO to GRN to supplier invoice to payment, VAT return, month-end close, bank rec |
| Golden files | Snapshot tests | Reports (TB, P&L, BS, VAT return, payslip) against accountant-approved fixtures |
| Performance | k6 | Target: 100k journal lines per company, report under 5 s (set the target with the owner) |
| Security | OWASP ZAP, dependency audit | Plus an independent penetration test before launch |
| Accessibility | axe | WCAG 2.1 AA on core flows |
| Chaos/recovery | Scripted | Backup restore drill, failed-job retry, partial import rollback |

**Test data:** deterministic seeded Zambian companies (retailer, construction firm, services firm) with known expected outputs, reviewed by the accountant.

## 10. COMPLIANCE REGISTER (`docs/compliance/register.md`)

Each entry: rule, source/citation, effective date, implementation location, test reference, `verified_by` (name, qualification, date), status (`VERIFY` | `VERIFIED`). Claude Code may add `VERIFY` entries but may never mark one `VERIFIED`. Only a human reviewer does.

## 11. DEFINITION OF DONE (per PR)

- [ ] Failing tests were written first; the suite is now green (typecheck, lint, unit, property, integration, e2e)
- [ ] §6 invariants suite passes
- [ ] Reviewed by a different model; findings resolved or logged
- [ ] §8 checklist applied where relevant
- [ ] Migrations reversible and tested on a production-sized dataset
- [ ] Compliance register updated; no unverified statutory value shipped to production
- [ ] CHANGELOG and ADR updated; docs and OpenAPI regenerated
- [ ] No dynamic Tailwind class construction; no components defined inside components

## 12. RELEASE GATES (human sign-off required, not AI)

1. All invariant, property and e2e tests green on CI.
2. Zambian chartered accountant (ZICA/ACCA member) has signed off VAT, payroll, statutory statements and report layouts. Signature recorded in the register.
3. ZRA Smart Invoice sandbox acceptance confirmed in writing (if in scope).
4. Independent penetration test complete with no open critical or high findings.
5. Pilot with 3 to 5 SMEs running in parallel with their existing books for at least two month-ends, reconciled to the kwacha with variances explained.
6. Backup and restore drill passed; rollback plan documented.
7. Data protection review complete; terms, privacy policy and DPA reviewed by counsel.
8. Support runbook, incident process and status page in place.

## 13. REPOSITORY LAYOUT

````text
/apps/web            React app
/apps/api            HTTP API
/packages/ledger     Posting engine, invariants (pure, no I/O)
/packages/tax-zm     Zambian tax rules + versioned rate data
/packages/shared     Money, dates, validation schemas
/docs/adr            Architecture decision records
/docs/compliance     register.md, sources, sign-offs
/tests/e2e           Playwright suites
/.claude             agents, commands, settings (hooks)
/CLAUDE.md           this file
````

## 14. OPERATING NOTES FOR CLAUDE CODE

- Start with Phase 0, then Phase 1. Do not port UI before the ledger passes §6.
- The prototype's `ZambianERPSystem` component is reference only. Do not copy its data model: it uses names instead of IDs, floats, hard deletes and unbalanced seed data.
- Prefer small PRs. One invariant or one feature per PR.
- When blocked by a missing rule, credential, or decision, stop and ask. Do not invent.
- Be direct and sceptical in reviews. Flag risk early, with evidence.
