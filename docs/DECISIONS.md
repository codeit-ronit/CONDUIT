# Decision Log

This index records important decisions. Detailed decisions use Architecture Decision
Records (ADRs), which are never silently rewritten after acceptance. If a choice
changes, add a new ADR that supersedes the old one.

| ID                                                                       | Decision                                     | Status   | Why it helps                                                                 |
| ------------------------------------------------------------------------ | -------------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| [ADR-0001](decisions/ADR-0001-rebuild-principles.md)                     | Rebuild around a deterministic trust kernel  | Accepted | Preserves the proven idea without copying old structure                      |
| [ADR-0002](decisions/ADR-0002-modular-monolith.md)                       | TypeScript modular monolith for V1           | Accepted | One language and transactional simplicity while boundaries remain explicit   |
| [ADR-0003](decisions/ADR-0003-canonical-domain-and-adapters.md)          | Stable internal model; protocols at adapters | Accepted | External specifications can evolve without rewriting core rules              |
| [ADR-0004](decisions/ADR-0004-versioned-catalog-and-order-snapshots.md)  | Version prices and snapshot orders           | Accepted | Price changes remain explainable and cannot rewrite old receipts             |
| [ADR-0005](decisions/ADR-0005-durable-trusted-commit.md)                 | Durable trusted commit and provider outbox   | Accepted | Crashes and ambiguous provider results recover without duplicate effects     |
| [ADR-0006](decisions/ADR-0006-runtime-tool-governance.md)                | Discover and reconcile every live tool       | Accepted | Unknown capabilities and changed schemas fail closed before execution        |
| [ADR-0007](decisions/ADR-0007-audit-chain-and-redaction.md)              | Serialize audit; tokenize before persistence | Accepted | Concurrent evidence stays complete and tested output surfaces contain no PII |
| [ADR-0008](decisions/ADR-0008-bounded-model-runtime.md)                  | Bound every model behind one runtime         | Accepted | Model quality can vary without changing authority, money, or termination     |
| [ADR-0009](decisions/ADR-0009-reviewed-merge-only-catalog-onboarding.md) | Review and merge catalog imports             | Accepted | Sources and models can add products without silently rewriting catalog truth |

## Short-form product decisions

These are binding until promoted or superseded:

- Use AI for interpretation/ranking/explanation, not authority.
- Use PostgreSQL transactions from the first commit flow.
- Event-source authorization drawdowns only; keep ordinary current-state models for
  catalog and carts with history where required.
- Use an outbox and reconciliation worker for external effects.
- Build multi-tenant identity into the schema from the first vertical slice.
- Start with modelled payments; call an integration real only after a dated sandbox test
  and captured schema/manifest evidence.
- Target MCP first for tool transport and UCP first for commerce compatibility.
- Do not add RAG or a vector database to core product search.
