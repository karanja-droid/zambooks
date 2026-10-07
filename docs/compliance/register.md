# Compliance Register

Spec §10. Claude Code may add `VERIFY` rows; only a named human reviewer may set `VERIFIED`. Linted by `pnpm check:register`. The linter checks format only; the control is the Claude Code PreToolUse hook (which blocks AI writes of VERIFIED) plus human PR review.

| ID | Rule | Source | Effective | Implementation | Test | verified_by | Status |
|---|---|---|---|---|---|---|---|
| ZM-0001 | Default Zambian SME chart of accounts and IFRS for SMEs line mapping | IFRS for SMEs Sections 4–5; accountant review pending | 2026-10-07 | packages/ledger/templates/zm-sme-default.json | packages/ledger/src/coa.test.ts |  | VERIFY |
| ZM-0002 | FX conversion rounds half-to-even to the functional currency minor unit | Internal policy proposal, ADR-0003; accountant review pending | 2026-10-07 | packages/shared/src/fx.ts | packages/shared/src/fx.test.ts |  | VERIFY |
| ZM-0003 | FX rounding differences per journal post to a designated rounding account (8999) | Spec §6.10; accountant to confirm account and presentation | 2026-10-07 | packages/ledger/src/validate.ts | packages/ledger/src/validate.test.ts |  | VERIFY |
