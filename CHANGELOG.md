# Changelog

## [Unreleased]
### Added
- Monorepo scaffold, CI gates, compliance register and linter, Claude Code agents/hooks.
- `@zambooks/shared`: Money, FX conversion, ISO date check.
- `@zambooks/ledger`: domain model, posting engine, reversals, periods, CoA template, trial balance, invariant property suite.

### Security
- Path guard resolves symlinks and case aliases, fails closed on malformed hook input, and protects its own hooks, settings, CI workflow, CODEOWNERS and register linter.
- CI runs with a read-only token, without persisted credentials, and runs the hook test suite.
- `.github/CODEOWNERS` covers the compliance register and guard files. **Action needed:** confirm the owner handle and enable "require code owner review" on `main`.

### Known issues (plan 01, deferred)
- No SAST/SCA/secret scanning in CI (spec §8). Required before plan 02, the first plan to handle secrets.
- GitHub Actions are pinned to major tags, not commit SHAs.
- Error codes are imprecise in places: a rounding line on the wrong account raises NO_ROUNDING_ACCOUNT, and more than one rounding line raises UNBALANCED. `CURRENCY_MISMATCH` is shared between LedgerError and MoneyError. Plan 04 error mapping must disambiguate.
- `LedgerError` messages include amounts. Plan 04 must log `.code` only (§8).
- `closePeriod` needs no role, the actor id is not checked for blank, and the returned `AuditEvent` is not bound to persistence. Plans 02 and 03 must persist the books change and the audit append in one transaction.
- The SoD approver is a caller-supplied string. Plan 03 must source `approverId` from an authenticated approval action and use canonical opaque user ids.
- Whether the original poster may approve a reversal (T7) is an open SoD policy question for plan 03.
- Tenancy relies on books built via `openBooks`/`commit`. The plan 02 loader must validate through `openBooks` and keep RLS as the primary control.
- Party kind is not checked against the control account (an AR line can carry a supplier). This belongs to plan 06 sub-ledgers.
- `commit` checks for duplicate journal ids with a linear scan. Plan 02 should add an id index.
- The template status can drift from the register row. A plan 10 CI check should compare them.
- ZM-0001 review notes: the VAT and WHT mapping to "Current tax liabilities", no income tax expense or payable accounts, and a single FX gain/loss account. All of these are pending the accountant.
- Lint bans for money arithmetic and impurity catch direct forms only. Aliases (`const N = Number`, `globalThis.Math.round`, bare `fs` imports) are not caught, so review must catch them.
- The path guard does not protect root `package.json`, `eslint.config.js` and `turbo.json`, and they are not in CODEOWNERS. A human should add them to CODEOWNERS; the agents cannot, because CODEOWNERS is guarded.
- Hard links to protected files are not detected by the path guard.
