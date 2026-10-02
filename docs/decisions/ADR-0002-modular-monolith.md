# ADR-0002: TypeScript modular monolith for V1

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

The project needs a browser product, APIs, typed tool schemas, an MCP surface, workers,
and rigorous tests. The learner should not have to cross several languages to follow one
purchase. Financial state transitions also benefit from one relational transaction
boundary.

## Decision

Use an end-to-end TypeScript monorepo and PostgreSQL. Keep domain, application,
contracts, adapters, agent runtime, and evaluations in separate packages with automated
dependency rules. Deploy API/web/worker separately when useful, but do not introduce
network boundaries between domain modules in V1.

## Consequences

- Shared types reduce translation mistakes and cognitive load.
- PostgreSQL can enforce uniqueness and atomicity that process locks cannot.
- TypeScript types do not validate network input; runtime schemas remain mandatory.
- If Phase 0 finds a decisive SDK or team constraint, this ADR can be replaced before
  much code exists.

## Validation note

The TypeScript 6, pnpm workspace, strict lint/type/test, package-boundary, and CI parts
were validated on 2026-10-02. PostgreSQL 18.6 was then started through Docker/Colima;
repeatable migrations and transaction rollback were verified against the live server.
