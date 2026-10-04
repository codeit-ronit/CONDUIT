# V1 Architecture

## One-picture view

```text
Human confirms typed intent
          │
          ▼
   Buyer agent runtime  ───── merchant prose is untrusted
          │ proposes typed tool calls
══════════╪═══════════════════════════════════════════════
 ENFORCEMENT BOUNDARY
 validate schema → classify → redact/quarantine → policy → audit
          │ allowed call only
══════════╪═══════════════════════════════════════════════
          ▼
 Commerce application
 catalog → cart → commit gate → authorization ledger → outbox
          │                                      │
          ▼                                      ▼
     PostgreSQL                         provider adapter/worker
```

Above the double line, assume mistakes and manipulation. Below it, use typed data,
deterministic rules, database constraints, and transactions.

## The catalog onboarding boundary

Merchant files and storefront pages are untrusted sources. They cannot write directly to
catalog tables:

```text
CSV/XLSX or public URL
        │
        ▼
deterministic mapping/extraction → normalized rows + reasons → durable preview
        │ exact fingerprint confirmed
        ▼
transactional merge of new SKUs → field provenance → bounded buyer catalog
        │
        ├── existing SKU: skip; preserve current price
        └── AI attribute: pending until human review
```

Storefront fetching resolves and validates all IP addresses at every redirect, then pins
the connection to the approved address. Only structured JSON-LD, microdata, and Open
Graph facts become mapped fields. Descriptions remain untrusted prose. A file or page
can therefore contribute data, but it cannot silently expand its authority into price
changes, private-network access, or autonomous model writes.

## The merchant-console identity boundary

The merchant console never accepts tenant or merchant scope from the browser:

```text
password → salted scrypt comparison → random browser token
                                      │
                         PostgreSQL stores only token digest
                                      ↓
active session → merchant membership → scoped catalog + provenance read
```

The raw session token travels only in an `HttpOnly`, `SameSite=Strict` cookie. Logout,
expiry, and password changes revoke database sessions. Catalog and provenance queries
receive tenant/merchant identity only from the joined session membership. This local
identity is a product demonstration, not a replacement for production MFA, SSO,
recovery, throttling, HTTPS, and security-event controls.

## The evidence layer

`@conduit/evals` depends on domain/security modules but no production module depends on
it. It turns existing executable stories into observations and compares them with a
versioned manifest:

```text
manifest (expected first) + scenario executor → observation → exact grader
                                                        │
                                                        ├── per-scenario evidence
                                                        └── hard-zero build gate
```

The red-team path runs a deterministic adversarial stand-in against production redaction
and policy functions. Unsafe variants exist only in the evaluation package; there is no
deployable flag that disables controls. Reports keep `SCRIPTED`, `MODELLED`,
`REAL_LOCAL_DATABASE`, and `LIVE_MODEL` evidence separate.

## The bounded buyer loop

The model has two jobs: propose typed intent and propose one next action. It does not
own the loop. `@conduit/agent-runtime` validates model output, requires an exact intent
fingerprint confirmation, filters invalid products in code, and enforces step, time, and
repetition budgets.

```text
human request → typed proposal → exact confirmation → deterministic candidates
      → model proposes one action → boundary → server-priced cart/commit gate
      ↘ invalid, repeated, over budget, or impossible → safe terminal state
```

Scripted, deliberately flawed, and OpenAI adapters implement the same two-method
strategy. The live adapter uses strict Structured Outputs, but local schema validation
still runs because structured shape is not business truth. Provider selection never
changes available tools or policy.

## The tool boundary flow

Every internal or external adapter presents runtime-discovered tool descriptors. The
boundary does not carry a hardcoded allow-list. It reconciles each discovered schema
hash with a tenant approval stored in PostgreSQL, then applies this order:

```text
discover → reconcile snapshot → validate arguments → check run permission
        → append DECISION → forward or block → append OUTCOME
```

Unknown tools, schema drift, discovery errors, and invalid arguments fail closed. Tool
classification comes from the approved snapshot—not from the provider being governed.

Structured values are labelled as trusted data. Merchant prose is tokenized, wrapped
with a per-run nonce, and marks the durable run `QUARANTINED`. Reads and reversible
writes remain usable; binding or external effects then need explicit one-call approval.

The audit head is locked per tenant in PostgreSQL, which creates a gapless sequence
under concurrent processes. PostgreSQL calculates each hash and an independent Node
verifier checks the chain. This is tamper-evident only; no external anchor exists yet.

## Why a modular monolith?

Microservices would add network failures and distributed transactions before we have
product evidence. A single tangled application would make later separation painful. A
modular monolith gives us one deployable system with enforced package boundaries. We
split a module into a service only after measurements show a separate scaling, security,
or ownership need.

## The authoritative purchase flow

1. The user reviews a typed authorization derived from their request.
2. The agent searches structured catalog fields and sees free text as untrusted content.
3. Cart edits are local and reversible. The server calculates every display total from
   current catalog versions.
4. Commit receives an operation key and the total the agent believes it saw.
5. The server locks/reloads the cart and reprices it from current catalog rows.
6. It distinguishes a changed price from wrong agent arithmetic.
7. It validates tenant, merchant, expiry, revocation, currency, item constraints,
   cumulative limit, and policy version.
8. In one database transaction it reserves stock, appends a drawdown RESERVE, records
   the operation identity, and creates an outbox command.
9. The worker sends the command to the provider with the same idempotency key.
10. A definite success appends CONFIRM; a definite failure appends RELEASE. An ambiguous
    result remains UNKNOWN and is reconciled by querying the provider.
11. A receipt links the confirmed intent, catalog versions, checkout, policy decision,
    ledger entries, provider reference, and audit-chain position.

The outbox means the database transaction and external network call are not pretended to
be one atomic action. Instead, incomplete work is durable and can be resumed safely
after a crash.

## Data ownership

| Module            | Owns                                                     | Must not decide              |
| ----------------- | -------------------------------------------------------- | ---------------------------- |
| Identity/tenancy  | users, sessions, memberships, tenant scope               | prices or payments           |
| Catalog           | products, attributes, price versions, source provenance  | cart lifecycle               |
| Cart              | quantities and cart state                                | authoritative price storage  |
| Authorization     | user-granted scope and drawdown events                   | product ranking              |
| Policy            | pure decision from a complete context                    | I/O or current time lookup   |
| Commit            | ordered transaction and recovery state                   | what the user wants          |
| Agent runtime     | interpretation, ranking, explanation                     | binding totals or permission |
| Boundary          | schema checks, trust treatment, policy invocation, audit | domain business rules        |
| Provider adapters | translate canonical commands and responses               | alter authorization          |

## Important invariants

- Money is `(currency, integerMinorUnits)`; currencies never combine implicitly.
- Every row carrying business data has a tenant owner or is explicitly global.
- Catalog price is versioned and is the only binding price source.
- A cart line stores product identity and quantity, not an agent-supplied price.
- A confirmed drawdown cannot exceed the authorization amount.
- One operation key maps to at most one provider-side effect.
- Ambiguous external results are reconciled, never treated as failures.
- Policy evaluation is a pure function of a versioned context.
- Unknown tools, rules, schemas, states, and provider results fail closed.
- Audit text is redacted before persistence, not only before display.
- Every intercepted call has one audit decision and one audit outcome.
- Untrusted prose can narrow authority but can never widen it.

## Protocol strategy

CONDUIT has a canonical internal model. External standards translate at the edge:

- **MCP:** tool discovery and invocation transport.
- **UCP:** merchant discovery, cart/checkout/order vocabulary and schemas.
- **ACP:** another checkout integration surface, especially relevant to the
  OpenAI/Stripe ecosystem.
- **AP2:** cryptographic checkout/payment authorization and receipt concepts.
- **x402:** machine-to-machine paid HTTP resources; relevant research, not the default
  retail payment rail.

We do not force these different protocols into one abstraction. Each solves a different
problem, changes independently, and must carry its own version and conformance evidence.

### First UCP vertical slice

`@conduit/protocol-adapters` now owns a UCP `2026-08-25` catalog-search projection. The
discovery profile advertises only that capability. Protected work follows this order:

```text
Bearer credential → UCP-Agent identity binding → exact version intersection
                  → credential tenant/merchant scope → application catalog read
                  → UCP catalog response
```

The adapter depends on the domain shape; domain and application code do not depend on
UCP. The local profile is inspectable at `/.well-known/ucp`, but localhost HTTP and the
absence of an official schema/conformance run mean conformance is explicitly not
claimed. Checkout and payment handlers are not advertised.

### Authenticated MCP catalog transport

The same catalog boundary is now reachable through modern MCP Streamable HTTP. MCP is
only transport; it cannot choose commerce authority:

```text
Bearer → credential principal/scope → MCP initialize + tool discovery
       → search_catalog with UCP-Agent profile → identity/version checks
       → scoped application catalog read → structured UCP result
```

The official MCP client and server SDKs execute this path. Invalid bearer credentials
stop before protocol dispatch, and an agent-profile mismatch stops before PostgreSQL.
The browser can request a server-side demonstration but never receives the generated
bearer secret. Local API keys, localhost-only Host/Origin guards, and the SDK's in-band
tool-error representation mean this is executable partial compatibility—not an official
UCP MCP conformance claim.
