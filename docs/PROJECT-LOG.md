# Project Log

## 2026-10-02 — Knowledge transfer and V1 foundation

### What we did

- Read the complete 1,082-line knowledge-transfer document.
- Separated durable principles from the old implementation and its weaknesses.
- Checked current primary sources for MCP, UCP, ACP, AP2, x402, and prompt injection
  guidance.
- Found material protocol drift: UCP is now a concrete compatibility option and current
  AP2 v0.2 no longer matches the older three-mandate summary exactly.
- Defined a V1 product promise, phased implementation plan, architecture, research
  register, and decision-log process.
- Initialized local Git version control.

### Decisions and why

- **Rebuild, do not port.** This keeps the proven trust-boundary thesis without
  inheriting accidental complexity.
- **Canonical domain plus adapters.** External standards are useful and moving; the core
  business invariants must remain stable.
- **Database correctness from the start.** Concurrency, tenancy, idempotency, and money
  cannot be retrofitted safely after a demo architecture hardens.
- **AI outside the authority path.** This lets us use capable models without asking
  probabilistic software to guarantee financial invariants.

### Limits and unknowns

- No application code or provider integration exists yet.
- The TypeScript stack is proposed and must be validated in Phase 0.
- The payment provider is intentionally undecided because the KT file does not provide
  enough current, named, live-account evidence.
- No protocol-conformance claim is being made.

### Next action

Run the Phase 0 environment check, scaffold the workspace, implement `Money` and
foundational contracts, and add the first invariant/forbidden-import tests.

## 2026-10-02 — Phase 0A: executable money foundation

### What we built

- A pnpm/TypeScript monorepo with strict compiler, ESLint, Prettier, Vitest, and GitHub
  Actions checks.
- `@conduit/domain`, beginning with immutable, exact `Money` arithmetic using currency
  plus BigInt minor units.
- `@conduit/contracts`, beginning with strict runtime schemas for JSON money values.
- Seventeen tests covering arithmetic, serialization, malformed input, currency
  mismatch, and the domain dependency boundary.
- A learning note that explains why the domain type and transport contract are
  deliberately separate.

### What we learned

- The newest package version is not automatically the compatible choice. TypeScript
  7.0.2 was newer, but the selected TypeScript-ESLint version supports TypeScript below
  6.1, so the project pins TypeScript 6.0.3.
- Compile-time types do not protect a network boundary. Runtime validation is required
  before raw JSON enters domain code.
- Standard JSON cannot carry BigInt, so exact minor units travel as canonical decimal
  strings and convert only after validation.
- A first build emitted compiled tests into `dist`, and Vitest then ran both source and
  compiled copies, falsely reporting 34 passing tests. Production builds now exclude
  tests and the test runner explicitly excludes build output. A green number must be
  inspected to ensure it measures what we think it measures.

### Evidence

- `pnpm check` passes formatting, linting, type checking, 17 tests, and package builds.
- The domain architecture test rejects Node built-ins, external packages, and imports
  from other CONDUIT layers in production domain source.

### Remaining Phase 0 gap

Docker and `psql` are not installed on the development machine. PostgreSQL migrations
and transaction tests therefore remain intentionally unimplemented rather than being
replaced with a different database that would weaken our architecture evidence.

### Next action

Enable a local PostgreSQL environment, then add tenant/merchant identifiers, database
migrations, migration validation, and the first catalog vertical slice.
