# ADR-0001: Record architecture decisions

- Status: Accepted
- Date: 2026-10-07

## Context
Spec §2 requires a written ADR to override any stack default, and §3 step 8 requires ADRs for decisions.
## Decision
Decisions are recorded as numbered markdown files in docs/adr using 0000-template.md. Superseded ADRs are kept and linked, never deleted.
## Consequences
Every PR that makes a decision adds or updates an ADR; reviewers reject undocumented decisions.
