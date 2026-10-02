# V1 Implementation Plan

**Plan version:** 1.0 **Date:** 2026-10-02 **Planning principle:** complete thin,
testable vertical slices. A phase is done only when its exit test passes; a folder or
class existing is not progress by itself.

## Proposed technical foundation

Use a TypeScript monorepo so the API, browser app, contracts, MCP tools, and tests share
one type system. The proposed stack is Node.js, pnpm workspaces, Fastify, Next.js, Zod,
PostgreSQL, and a lightweight SQL mapper. This is an initial decision, not a permanent
truth; the first implementation slice will validate it before the domain becomes large.

Build a **modular monolith**: one repository and one database, with strict module
boundaries. It can run as API, web, and worker processes. This gives us simple local
development and transaction safety now, while leaving seams that can be split later if
real load requires it.

## Target repository shape

```text
CONDUIT/
├── apps/
│   ├── api/                 # HTTP API and inbound protocol endpoints
│   ├── web/                 # buyer, merchant, audit, and evaluation UI
│   └── worker/              # outbox delivery and payment reconciliation
├── packages/
│   ├── domain/              # money, catalog, cart, mandate, policy; no I/O
│   ├── application/         # use cases and transaction orchestration
│   ├── contracts/           # versioned schemas and reason codes
│   ├── infrastructure/      # PostgreSQL and provider adapters
│   ├── agent-runtime/       # model adapter and bounded tool loop
│   ├── protocol-adapters/   # MCP first; UCP/ACP/AP2 compatibility later
│   ├── evals/               # scenarios, graders, red-team and reports
│   └── observability/       # traces, audit events, redaction
├── db/                      # migrations and seeds
├── docs/                    # project memory and learning material
└── tests/                   # cross-module acceptance and invariant tests
```

Dependency direction is inward: adapters may depend on application/domain; domain never
imports a web framework, database, model SDK, or payment SDK.

## Phase 0 — foundation and executable contracts

**Status: complete on 2026-10-02.** The toolchain, exact money/contracts, PostgreSQL
18.6 environment, transactional migrations, live integration tests, and CI gate are
operational.

**Build**

- Workspace, formatter, linter, type checker, unit test runner, CI, and conventional
  commit guidance.
- Immutable `Money`, identifiers, clocks, reason codes, result types, and versioned JSON
  contracts.
- A terminology glossary and first architecture-decision records.
- Local PostgreSQL configuration and migrations.

**Learn**

- Why money uses integer minor units.
- Domain objects versus API payloads.
- Why dependency direction matters.

**Exit test**

- One command runs formatting checks, type checks, unit tests, and migration validation.
- Floats cannot enter a money constructor.
- Domain package has an automated forbidden-import test.

## Phase 1 — deterministic commerce walking skeleton

**Status: complete on 2026-10-02.** Multi-tenant merchant/catalog storage, versioned
prices, inventory, server-priced mutable carts, transactional modelled commit, immutable
order snapshots, a deterministic demo, and live PostgreSQL acceptance tests are working.

**Build**

- Tenant-aware merchant and catalog records, versioned prices, explicit product
  attributes, stock, cart, and server-computed cart totals.
- Create cart, add/update/remove line, and read cart use cases.
- A fake payment/order provider and one non-AI scripted buyer.
- A transactionally correct commit that creates exactly one modelled order.

**Why first**

The commerce loop must work without an LLM. Otherwise model behaviour hides ordinary
commerce bugs.

**Exit test**

- A scripted buyer completes a modelled purchase end to end.
- Client-supplied price or tenant identity is rejected.
- Two merchants may use the same SKU without collision.

## Phase 2 — the trust kernel

**Status: complete on 2026-10-02.** Typed grants, pure policy decisions, append-only
drawdown, stock/spend reservations, operation idempotency, durable provider outbox,
unknown-state reconciliation, stale-worker recovery, isolated database testing, and a
live six-scenario Trust Lab are operational with a MODELLED provider.

**Build**

- Typed authorization grant: tenant, buyer, merchant, currency, maximum amount, allowed
  categories/SKUs, expiry, revocation state, and policy version.
- Append-only RESERVE/CONFIRM/RELEASE/REVERSE drawdown entries.
- Pure policy rules returning ALLOW, DENY, or REQUIRE_APPROVAL plus reason, explanation,
  and recovery action.
- Ordered commit gate: cart state → live reprice → stated-total comparison →
  authorization scope → stock reservation → drawdown reservation → policy → idempotency
  → provider call → confirmation/release.
- Database transaction boundaries, unique operation keys, durable outbox, and
  unknown-payment reconciliation.

**Exit test**

- Planted wrong arithmetic and a real price change produce different reason codes and
  itemized explanations.
- Concurrent identical commits produce one order.
- A crash at every boundary leaves a recoverable state and never overspends.
- Provider timeout enters UNKNOWN and queries provider state before any retry.

## Phase 3 — enforcement boundary and audit

**Status: complete on 2026-10-02.** One interceptor now governs discovered tools using
approved schema snapshots, closed classifications, trust labels, durable permission
narrowing, central tokenization, and a PostgreSQL-serialized hash chain. Seven new live
demo scenarios make the boundary and evidence visible.

**Build**

- One tool-call interceptor for internal and external tools.
- Runtime tool discovery, schema snapshotting, classification, allow-list
  reconciliation, and deny-by-default handling for drift.
- Trust labels for operator input, structured tool data, and untrusted prose.
- Per-run quarantine markers and permission narrowing after untrusted content.
- Central redaction/tokenization before prompts, logs, traces, and audit.
- Gapless tenant-aware audit sequence with hash chaining and policy/context version
  fingerprints.

**Exit test**

- Unknown or changed tools are denied before execution.
- Every proposed call has one audit decision and one outcome.
- Concurrent audit writes verify as a complete chain.
- Seeded PII appears on no output surface.

## Phase 4 — bounded AI buyer

**Build**

- Provider-neutral model interface with structured output validation.
- Two-step intent flow: model proposes typed constraints; user confirms them.
- Explicit state machine with a small tool set, step budget, time budget, and loop
  detection.
- Deterministic filtering before model ranking; server totals after every cart mutation.
- A deterministic scripted agent for tests, a deliberately flawed agent for safety
  experiments, and one live-model adapter.

**Exit test**

- The same scenarios run against all three agents.
- Bad model output fails schema validation without side effects.
- A deliberately wrong stated total never becomes the charged total.
- An unsatisfiable request ends with a useful refusal instead of an infinite loop or
  silent constraint relaxation.

## Phase 5 — merchant onboarding

**Build**

- CSV/XLSX import with inferred mapping, preview, human confirmation, row-level reasons,
  and merge-only defaults.
- Storefront import from JSON-LD/microdata/Open Graph with SSRF-safe fetching, redirect
  revalidation, content limits, and provenance.
- Explicit price-change workflow; imports cannot silently overwrite prices.
- Human review for model-enriched attributes.

**Exit test**

- A real public storefront and a messy spreadsheet import into a fresh tenant.
- Every accepted field shows its source; every skipped row shows a reason.
- Private-network and redirect-based SSRF cases are blocked.

## Phase 6 — evidence, evaluation, and red team

**Build**

- Versioned scenario dataset whose expected results are written before runs.
- Metrics split into hard-zero invariants and quality measures.
- Paired guardrails-on/off prompt-injection trials and one-control-at-a-time ablations.
- Property-based tests for money, ledger, policy, and idempotency; concurrency and
  crash-point tests for commit.
- Reports that distinguish scripted-agent evidence from live-model evidence.

**Exit test**

- Unauthorized effects, cap violations, duplicate charges, cross-tenant access, and PII
  leaks are zero.
- At least one attack succeeds with a relevant control disabled and fails safely with
  controls enabled, proving the test is meaningful.

## Phase 7 — presentable product and interoperability

**Build**

- Buyer console, merchant console, trusted/untrusted catalog view, live run timeline,
  receipt, audit explorer, and evaluation dashboard.
- Visible REAL / MODELLED / REFERENCED labels.
- Authenticated MCP shopping surface.
- UCP checkout adapter as the first commerce-standard target; ACP/AP2 adapters remain
  separate and are added only with explicit conformance tests.
- Sandbox payment-provider adapter after live manifest/schema verification.

**Exit test**

- A new user can understand authorization → selection → commit → payment → receipt
  without reading source code.
- The demo clearly identifies which external calls are real.
- Protocol/provider claims link to a dated conformance or manifest report.

## Definition of done for every slice

- Behaviour and threat addressed are documented.
- Unit tests cover rules; integration tests cover persistence; acceptance tests cover
  the user-visible flow.
- Failure paths and structured recovery are tested, not only the happy path.
- Telemetry contains correlation IDs and no raw PII.
- A decision record exists for non-obvious trade-offs.
- The project log explains what changed, what was learned, and the next step.
- The change is committed in a small, reviewable Git commit.

## Immediate next step

Begin Phase 4 with a provider-neutral model interface, typed intent confirmation, and a
bounded agent state machine. Route every agent tool proposal through the completed Phase
3 boundary and compare scripted, deliberately flawed, and live-model behavior.
