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

## 2026-10-02 — Phase 0B: Docker and PostgreSQL foundation

### What we built

- Installed Docker CLI 29.8.2, Docker Compose 5.5.1, and Colima 0.10.3 after Docker
  Desktop's DMG failed to mount on macOS.
- Started and verified a Docker 29.5.2 Linux engine with the ARM64 `hello-world` image.
- Added a PostgreSQL 18.6 Compose service bound only to localhost, with a health check
  and persistent named volume.
- Added versioned, locked, transactional migrations and a dedicated `conduit` schema.
- Added a bounded PostgreSQL connection pool and production configuration guard.
- Added live integration tests and CI database verification.

### What we learned

- Installing a Docker client does not prove a daemon exists. A real disposable container
  is the useful verification.
- Container health and process start are different events. Migrations wait for
  `pg_isready`, rather than racing PostgreSQL initialization.
- A named volume outlives replaceable containers; normal shutdown must not destroy it.
- Migration idempotency is observable: the first run applied one migration and later
  runs applied none.
- The down path removed the schema/extension and the up path rebuilt them before all
  integration tests passed again.
- A first database test queried `SHOW server_version_num` but assumed the result column
  was named `setting`. We replaced that assumption with an explicit SQL alias and reran
  the live test.

### Evidence

- PostgreSQL returned `server_version_num = 180006`.
- The `conduit` schema, `pgcrypto` extension, and one migration record were verified.
- A probe table created inside a transaction did not exist after rollback.
- The unit suite remains separate from database integration tests, so the pure domain
  does not acquire an infrastructure dependency.

### Next action

Begin Phase 1 with tenant and merchant identities, then a versioned catalog repository
and the first end-to-end catalog API slice.

## 2026-10-02 — Phase 1: deterministic commerce walking skeleton

### What we built

- Branded tenant, merchant, product, cart, and order identifiers plus closed commerce
  error codes.
- Strict tenant/merchant/product/cart input contracts that reject unknown fields.
- Multi-tenant PostgreSQL tables with composite ownership constraints.
- Products with structured attributes, isolated merchant prose, stock, and non-
  overwriting price history.
- Server-priced carts with create, add, update, remove, read, and commit operations.
- A transactionally committed MODELLED order with inventory decrement and immutable
  order-line price snapshots.
- A deterministic provider seam and runnable `pnpm demo:commerce` flow.

### Evidence

- The pure suite passes 31 tests across five files.
- The live PostgreSQL suite passes eight tests across database and commerce scenarios.
- Two merchants can use the same SKU, while cross-tenant/cart access is refused.
- Two concurrent commits return one order and decrement stock once.
- Insufficient stock rolls the whole commit back.
- Later catalog repricing cannot change the committed receipt.
- The demo bought four ₹199.00 items for an exact server total of ₹796.00 and labelled
  the result MODELLED.

### Important lesson

JavaScript millisecond time was not precise enough to close a PostgreSQL microsecond
price interval safely. Moving close/open into one SQL statement with one database time
fixed the invariant at the layer that enforces it.

### Limits

This is commerce correctness, not yet financial authorization. There is no mandate,
policy engine, audit chain, real provider, outbox, payment reconciliation, HTTP/MCP
surface, or AI buyer.

### Next action

Build Phase 2's trust kernel: typed spending authorization, append-only drawdown ledger,
pure policy decisions, stock reservation, idempotency key, and the ordered commit gate.

## 2026-10-02 — Phase 2: trust kernel and live Trust Lab

### What we built

- Typed buyer grants covering tenant, merchant, currency, cumulative amount,
  category/SKU scope, expiry, revocation, and policy version.
- A pure `ALLOW` / `DENY` / `REQUIRE_APPROVAL` policy engine with stable reasons,
  explanations, and recovery actions.
- Claimed-versus-live itemized quote comparison that separates wrong arithmetic from a
  real catalog price change.
- Append-only drawdown and transactional stock/spending reservations.
- Tenant-scoped operation keys that replay concurrent duplicate commits as one result.
- A durable provider outbox with worker leases, stale-claim recovery, definite-release
  handling, `PAYMENT_UNKNOWN`, and lookup-before-retry reconciliation.
- An isolated `conduit_test` database so test resets never erase normal demo data.
- A browser Trust Lab with six PostgreSQL scenarios and visible phase comparison, policy
  gates, quotes, ledger, stock, order, and outbox evidence.

### What we learned

- “Timeout” is not the same as “failure.” Unknown must remain a first-class state until
  the provider is queried.
- Idempotency needs both a database identity and provider identity. One without the
  other leaves a duplicate-effect gap.
- A durable outbox still needs a claim lease; otherwise a worker crash can strand a
  `PROCESSING` row forever.
- Testing infrastructure is product safety. A safety review stopped the old broad
  database reset, so integration tests now use their own disposable database.
- A useful live demo exposes intermediate states and evidence, not only a final receipt.

### Evidence

- `pnpm check` passes formatting, linting, strict type checking, 37 pure tests, and all
  package builds.
- `pnpm db:check` applies all migrations twice and passes 14 live PostgreSQL tests.
- Every Trust Lab scenario was executed against the local PostgreSQL container.
- The ambiguous-payment scenario showed `PAYMENT_UNKNOWN` and reconciled to `CONFIRMED`
  through lookup without a second authorization attempt.

### Limits

- Payments remain MODELLED; no production provider or real money is used.
- The ledger supports `REVERSE`, but a user-facing refund workflow is not exposed.
- Authentication, hash-chained audit, tool interception, and the AI buyer are later
  phases.

### Next action

Build Phase 3's enforcement boundary and tamper-evident audit trail, then show every
proposed tool call and its decision in the same Trust Lab.

## 2026-10-02 — Phase 3: enforcement boundary, privacy, and audit

### What we built

- Separate `@conduit/enforcement` and `@conduit/observability` packages so tool
  authority, redaction, and evidence do not leak into commerce domain code.
- One interceptor for internal and external-shaped tools with runtime discovery, exact
  schema hashing, tenant approvals, argument validation, and fail-closed decisions.
- Closed `READ_ONLY`, `REVERSIBLE_WRITE`, `BINDING_WRITE`, and `EXTERNAL_EFFECT`
  classifications controlled by approved records rather than live providers.
- `OPERATOR`, `TOOL_STRUCTURED`, and `UNTRUSTED_PROSE` provenance labels.
- Fresh per-run quarantine nonces and durable `CLEAN` → `QUARANTINED` state.
- Permission narrowing that requires one-call human approval for high-impact actions
  after untrusted prose appears.
- Central session tokenization for registered values, sensitive fields, email, phone,
  payment patterns, correlation metadata, tool output, errors, and audit payloads.
- One `DECISION` plus one `OUTCOME` audit entry for every proposed call.
- PostgreSQL tenant-head locking, gapless sequences, `pgcrypto` hash links, append-only
  triggers, and an independent Node verifier.
- A redesigned Phase 3 Trust Lab with separate Purchase Safety and Tool Boundary
  workspaces and seven new interactive scenarios.

### Decisions and why

- **Discover and reconcile; do not hardcode.** A static list cannot detect a newly
  appeared or changed provider capability.
- **Classification is local authority.** A provider cannot decide that its own tool is
  harmless.
- **Quarantine plus narrowing.** Delimiters help the model, but only deterministic
  permission loss makes manipulation harmless.
- **Database serialization.** A process mutex cannot keep audit order across replicas.
- **Redact before persistence.** Rendering-time cleanup is too late once a log exists.
- **Independent verification.** PostgreSQL creates hashes and Node verifies them so the
  checker does not merely repeat the same implementation path.

### Bugs found by evidence

- Concurrent entries were stored correctly but initially read in text order
  (`1, 10, 11, 2`). The independent chain test failed, and the query now sorts the
  bigint column before converting it for JavaScript.
- A privacy review found that correlation IDs also accept external text. They now pass
  through the same tokenizer, and the PII test seeds that surface explicitly.

### Evidence

- `pnpm check` passes formatting, linting, strict type checking, 43 pure tests, and all
  builds.
- `pnpm db:check` passes 19 live PostgreSQL tests after applying migrations twice.
- Ten simultaneous tool calls produce sequences 1–20 with one decision and one outcome
  per call.
- Unknown tools and schema drift cause zero runtime executions.
- Seeded sensitive names, emails, phone numbers, and correlation metadata appear on no
  tested response or audit surface.
- Normal audit updates and deletes are rejected; independent verification passes.
- All seven live Phase 3 demo endpoints return the expected decision and verified chain.

### Honest limits

- Hash chaining is tamper-evident, not tamper-proof; external anchoring is not built.
- Quarantine reduces injection risk but cannot guarantee model behavior.
- Automatic PII detection is incomplete by nature; known identity values must be
  registered, and production needs an encrypted token vault.
- The tool runtime is MODELLED and local. Authenticated MCP arrives in a later phase.

### Next action

Build Phase 4's bounded AI buyer above this boundary: typed intent confirmation, an
explicit state machine, step/time budgets, structured output validation, and comparable
scripted, flawed, and live-model adapters.

## 2026-10-02 — Phase 4: bounded AI buyer

### What we built

- A new `@conduit/agent-runtime` package with provider-neutral intent and action
  strategies.
- Strict, versioned Zod contracts for shopping intent and one-step model actions.
- Exact SHA-256 intent fingerprints so tools remain untouched until the proposed
  constraints are confirmed.
- An explicit runtime with six-step, 15-second, and repeated-action budgets.
- Deterministic category, stock, quantity, total-budget, attribute, and exclusion
  filtering before model ranking.
- Scripted, deliberately flawed, and OpenAI Responses API adapters.
- Real catalog, cart, review, and trusted-commit tools backed by PostgreSQL and routed
  through the Phase 3 boundary.
- A Phase 4 demo workspace showing intent, state transitions, intercepted calls,
  authoritative money, failure reason, and audit verification.

### Decisions and why

- **One loop, many strategies.** Provider substitution must not create different safety
  rules.
- **Confirmation binds typed data.** A natural-language sentence is not an executable
  authorization.
- **Filter before ranking.** Hard constraints belong in code; preference among valid
  candidates may belong to a model.
- **Structured output is shape, not truth.** Local validation, loop limits, policy, and
  the commit gate remain necessary.
- **Do not send merchant prose when it is unnecessary.** The boundary records and
  quarantines it, but Phase 4 ranking works from structured fields only.

### Evidence

- `pnpm test` passes 52 pure tests across 11 files.
- `pnpm db:check` passes all 19 PostgreSQL integration tests.
- The scripted live endpoint confirmed the server total of ₹398.00 with a verified audit
  chain.
- A flawed ₹0.01 stated total reached the real gate and stopped with
  `QUOTE_ARITHMETIC_MISMATCH`; nothing was charged.
- Malformed output made zero tool calls; repeated output stopped on the third identical
  action; an impossible ₹1.00 request refused after one read.
- The OpenAI transport contract is tested with an injected fake response. No real-model
  claim is made without configured credentials.

### Honest limits

- Live OpenAI execution is not configured or empirically evaluated yet.
- Agent sessions and confirmation records are process-local rather than durable.
- The current demo displays an exact confirmation step but does not yet authenticate a
  separate browser confirmation request.
- Catalog semantics depend on already-structured attributes; merchant onboarding is
  next.

### Next action

Build Phase 5's first merchant-onboarding vertical slice: reviewed CSV import with
mapping preview, row-level reasons, source provenance, merge-only defaults, and direct
compatibility with the bounded buyer.

## 2026-10-04 — Phase 5: reviewed merchant onboarding

### What we built

- A new `@conduit/onboarding` package for CSV/XLSX parsing, mapping inference, exact
  normalization, storefront extraction, fingerprints, and review workflows.
- Durable PostgreSQL import batches and rows, field-level product provenance, and AI
  attribute proposals.
- Preview-before-write confirmation and replay-safe, merge-only catalog transactions.
- Schema.org JSON-LD/ProductGroup, microdata, and Open Graph extraction without model
  interpretation of merchant prose.
- An SSRF-resistant fetcher with public-address checks, redirect revalidation, pinned
  connections, and redirect/time/body/content limits.
- Five Onboarding Lab scenarios for messy files, protected prices, structured web data,
  redirect attacks, and human-reviewed AI enrichment.

### Decisions and why

- **Imports propose; humans confirm.** The fingerprint binds the exact source, mapping,
  and normalized result that was reviewed.
- **Merge-only by default.** Existing SKUs are reasons, not update commands; explicit
  versioned price changes stay separate.
- **Structured facts only.** Models do not guess price or SKU from adversarial prose.
- **Provenance per accepted field.** Later explanations do not depend on the original
  source still existing.
- **AI enrichment waits.** A model suggestion becomes catalog truth only after human
  acceptance.

### Bugs and learning found by evidence

- The first real HTTPS check exposed Node's `lookup({ all: true })` callback shape. The
  pinned resolver now handles both single-address and all-address calls.
- The fixture used schema.org `Product`, while a live retailer used `ProductGroup`.
  Standards-based group support and a regression test were added without a
  retailer-specific selector.
- A qualitative `InStock` value is not a numeric inventory count. The importer records
  zero rather than inventing sellable quantity.
- The package audit found ExcelJS's transitive `uuid` below its patched range. A scoped
  pnpm override now resolves only that dependency to `11.1.1`; the XLSX test still
  passes and the production audit is clean. Deprecated legacy transitive packages remain
  a maintenance signal.

### Evidence

- `pnpm check` passes formatting, linting, strict type checking, 62 pure tests across 15
  files, and all builds.
- `pnpm db:check` passes 22 PostgreSQL tests across five files and validates all five
  migrations twice.
- All five Phase 5 demo endpoints run against the local PostgreSQL database.
- `pnpm audit --prod` reports no known vulnerabilities after the scoped override.
- On 2026-10-04, a real public Allbirds `ProductGroup` was fetched and its one product
  imported into a fresh local USD tenant: one imported, zero skipped.

### Honest limits

- The public-page check is dated evidence, not a promise that a retailer's HTML will
  never change. The visual demo uses a stable fixture.
- Availability words are not converted to numeric stock.
- Production still needs outbound firewalling and file-malware scanning in addition to
  application checks.
- Live OpenAI evaluation and real payments remain unconfigured.

### Next action

Build Phase 6 as a reproducible evidence system: versioned scenario expectations,
hard-zero invariant graders, paired guardrail/control ablations, and a visible report
that keeps scripted, modelled, referenced, and real evidence separate.

## 2026-10-04 — Phase 6: evidence, evaluation, and red team

### What we built

- A clean `@conduit/evals` package for versioned manifests, observations, graders,
  reports, hard-zero gates, generated invariants, and causal ablations.
- Nine prewritten scenarios covering flawed totals, invalid model output, loops,
  unsatisfiable intent, spending caps, concurrent replay, tenant isolation, PII, and
  redirect SSRF.
- Five hard-zero counts that fail the suite at any value above zero.
- Paired scripted attacks with all controls on, all controls off, and one control
  removed at a time.
- Ablation arms that call the production redactor, boundary policy, and purchase policy
  when enabled, without adding unsafe flags to application code.
- `pnpm eval:safety`, a PostgreSQL CI gate, and a Phase 6 Evidence Lab in the live demo.
- 2,500 generated money, ledger, and fail-closed policy cases per pure test run using
  pinned fast-check 4.10.2.

### Decisions and why

- **Expected before observed.** Changing target behavior is a reviewable manifest edit.
- **Hard zero means zero.** One duplicate effect or PII leak cannot be averaged away.
- **A/B proves relevance.** Controls-on success is paired with an arm where the same
  attack demonstrably lands.
- **No unsafe production switch.** Bypass exists only in the evaluation package.
- **Evidence tiers remain separate.** Scripted evidence is not live-model quality.
- **L1 is not authority.** A model may be fooled; L3 and L4 must remain zero.

### Bugs and learning found by evidence

- The first live run failed three scenarios because the observer demanded a commit
  outcome when a safe early stop correctly represented “no commit” as `null`. The
  adapter was fixed; expected safety outcomes were not weakened.
- The first ablation duplicated redaction and policy behavior. It was strengthened to
  invoke production control functions in enabled arms.
- Workspace relinking exposed that a package using Node APIs must declare Node types
  directly; transitive type availability is not a package contract.

### Baseline evidence

- Safety report: 9 passed, 0 failed; all five hard-zero metrics are zero.
- All controls on: L1=2, L3=0, L4=0.
- All controls off: L1=2, L3=1, L4=1.
- Redaction removed alone: L3=1, demonstrating a causal protection.
- Property tests generate 2,500 invariant cases per run and shrink failures.
- `pnpm check` passes 70 pure tests across 18 files and all builds.
- `pnpm db:check` passes 24 live PostgreSQL tests across six files.
- `pnpm eval:safety` exits successfully with the complete JSON evidence report.

### Honest limits

- The adversary is scripted; live-model novel-payload coverage is not measured.
- Tests are not formal proof of policy completeness.
- SSRF uses a controlled transport and does not contact private infrastructure.
- PII detection remains heuristic; production needs an encrypted token vault.
- Payments remain modelled; Razorpay or another provider is not part of this phase.

### Next action

Build Phase 7's buyer/merchant product surfaces and authenticated protocol adapter,
carrying evidence tiers into every claim. Start with UCP compatibility research; keep
live-provider and live-model validation separate.

## 2026-10-04 — Phase 7 slice 1: honest UCP product boundary

### What we built

- A new `@conduit/protocol-adapters` package for UCP discovery, authentication,
  negotiation, and catalog projection.
- A profile pinned to the current tagged UCP `2026-08-25` release that advertises only
  `dev.ucp.shopping.catalog.search`.
- Constant-time API-key digest verification plus mandatory binding between the
  credential principal and the `UCP-Agent` profile.
- Exact protocol/capability version intersection and fail-closed mismatch errors.
- Credential-derived tenant/merchant scope and a UCP-shaped catalog response sourced
  from real PostgreSQL product and price data.
- A public local `/.well-known/ucp` route and four visual UCP scenarios: discovery,
  authenticated catalog, impostor identity, and incompatible version.
- Visible REAL LOCAL / MODELLED / REFERENCED labels and an explicit `NOT_CLAIMED`
  conformance state.

### Decisions and why

- **Catalog before checkout.** It proves the protocol seam without advertising payment
  or finalization work that is not built.
- **Advertise narrowly.** Discovery is a contract, so absent implementation means absent
  capability.
- **Identity before data.** A valid secret with a different profile is still an
  impersonation attempt; failures cause zero catalog reads.
- **Scope from credentials.** Caller input cannot choose another tenant or merchant.
- **Exact versions only.** UCP explicitly does not infer capability compatibility from
  date ordering.
- **No conformance shortcut.** A local shape and unit tests are not an official schema
  or conformance-suite result.

### Honest limits

- The local server uses HTTP and therefore is not a conformant public UCP deployment.
- API keys are a supported pre-established mechanism, but this demo lacks durable key
  lifecycle, a secret manager, rate limiting, and remote profile discovery.
- The official schema validator/conformance suite has not run yet.
- Pagination, filters, lookup, cart, checkout, order, payment handlers, AP2, and MCP
  transport are not implemented or advertised in this slice.

### Next action

Build a buyer journey console on the bounded-agent/trusted-commit flow, then add an
authenticated MCP catalog binding that reuses this scope and capability boundary.

## 2026-10-04 — Phase 7 slice 2: buyer journey and authenticated MCP

### What we built

- A one-click buyer journey that explains authorization, safe selection, trusted commit,
  modelled payment, and durable receipt using the existing bounded-agent path.
- Per-stage SCRIPTED, REAL LOCAL DATABASE, and MODELLED evidence labels, including an
  explicit `realExternalCharge: false` payment statement.
- An authenticated `/mcp` Streamable HTTP endpoint built with the official MCP
  TypeScript SDK and pinned to its modern `2026-07-28` era.
- One strict `search_catalog` tool carrying the required UCP agent profile, exact UCP
  capability negotiation, and credential-derived tenant/merchant scope.
- An official MCP client round trip in both the live lab and PostgreSQL integration
  suite; the raw bearer never reaches the browser.
- REST and MCP service advertisements in the local UCP profile without expanding the
  advertised catalog-only capability.

### Decisions and why

- **Reuse the purchase path.** The journey is a view over tested application behavior,
  not a second demo-only implementation.
- **MCP transports; credentials scope.** Tool arguments cannot choose identity or
  merchant access.
- **Authenticate before dispatch.** Bad bearers stop at HTTP with zero protocol or data
  work; UCP agent identity is rechecked before the catalog read.
- **Use the official SDK.** This tests real MCP initialization, discovery, and tool-call
  behavior while keeping commerce logic in CONDUIT adapters.
- **Keep claims granular.** The payment is still modelled and UCP MCP conformance is
  partial/not claimed.

### Bugs and learning found by evidence

- A new integration expectation guessed ₹498.00, while the authoritative scripted
  journey selected two ₹199.00 items. The test was corrected to ₹398.00; the server
  price was not changed to satisfy a presentation assumption.
- The official high-level MCP server serializes a tool callback `ProtocolError` as an
  `isError` tool result. Identity mismatch remains fail-closed with zero catalog reads,
  but exact UCP error-envelope conformance needs separate work.

### Evidence

- `pnpm check` passes formatting, linting, strict type checks, 77 pure tests across 20
  files, and all package builds.
- `pnpm db:check` applies migrations idempotently and passes 29 PostgreSQL tests across
  seven files.
- `pnpm audit --prod` reports no known vulnerabilities with the pinned MCP packages.
- Pure MCP tests cover official-client discovery/call, pre-dispatch bearer rejection,
  and agent-profile impersonation with zero reads.
- PostgreSQL tests execute the complete MCP round trip and validate durable receipt
  evidence across the five journey stages.
- Local live endpoints expose `/api/journey/buyer-purchase`,
  `/api/protocol/mcp-roundtrip`, `/mcp`, and both transports in `/.well-known/ucp`.

### Honest limits

- MCP uses a process-local API-key credential and localhost HTTP; production should use
  TLS, durable credential lifecycle and current OAuth resource-server patterns where
  appropriate.
- UCP catalog-over-MCP shape is implemented, but official conformance is not claimed.
- Selection is scripted, payment is modelled, and no Razorpay or bank network is called.
- UCP checkout, order, payment handlers, remote profile retrieval, and browser session
  identity remain open.

### Next action

Build the merchant-facing catalog/provenance console and durable browser identity, then
research and implement the current UCP cart/checkout lifecycle behind executable schema
and finalization tests. Keep live-model comparison and payment-sandbox validation as
separate evidence tracks.
