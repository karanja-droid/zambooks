# ADR-0003: Money representation and rounding

- Status: Accepted (rounding mode pending accountant review, ZM-0002)
- Date: 2026-10-07

## Decision
- Amounts are `bigint` minor units in a frozen `Money` class tagged with an ISO currency. Parsing rejects excess precision rather than rounding.
- FX rates are plain decimal strings; conversion uses decimal.js (precision 50) and rounds half-to-even once, per line.
- Journal-level functional differences post to the company rounding account (spec §6.10).
- Contra accounts (allowances, accumulated depreciation) keep the type of the section they present in and carry opposite-sign balances.
- Database storage: BIGINT minor units (decided in plan 02).
## Consequences
TypeScript rejects arithmetic operators on Money; ESLint bans parseFloat and Math.round in money packages.
