# ADR-0002: Backend framework and ORM

- Status: Proposed — awaiting owner confirmation before plan 02
- Date: 2026-10-07

## Context
Spec §2 permits NestJS or Fastify, and Drizzle or Prisma.
## Decision
Fastify + Zod (via fastify-type-provider-zod) for the API; Drizzle with hand-reviewed SQL migrations.
Fastify keeps the HTTP layer thin over the pure ledger; Drizzle's SQL-first migrations make RLS policies and NUMERIC/BIGINT columns explicit and reviewable.
## Consequences
No DI container; modules are plain functions. Plan 02 owns the migration tooling.
