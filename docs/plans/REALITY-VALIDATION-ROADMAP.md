# Reality Validation Roadmap

**Status:** accepted execution plan  
**Date:** 2026-10-05  
**Parent plan:** [V1-PLAN.md](V1-PLAN.md)

## Why the roadmap changed

CONDUIT has a strong deterministic checkout foundation, but its strongest claims are
currently supported mainly by local PostgreSQL tests, scripted agents, and a modelled
payment provider. More local features would increase breadth without answering the
questions an interviewer, merchant, or payments engineer will ask:

1. Does a real model behave differently under attack?
2. Does a real provider effect survive timeout, replay, webhook, and refund paths?
3. Can another party verify delegated authority cryptographically?
4. Can an agent we did not write interoperate with the merchant?
5. Can somebody outside the project use it?

The next milestone is therefore **external proof**, not feature count.

## The narrowed V1 story

> CONDUIT is an evidence-grade reference merchant and safety testbed that lets an AI
> prepare or perform a purchase while deterministic code owns price, authorization,
> payment state, replay protection, and audit evidence.

This is deliberately narrower than claiming to be a universal trust intermediary. The
open benchmark and reference merchant are the immediate project. “Make long-tail
merchants agent-ready” remains a commercial hypothesis to test after external proof.

## What is ordinary and what is AI-specific

Correct checkout engineering remains essential:

- integer money, server pricing, row locks, idempotency;
- outbox delivery, webhook deduplication, unknown-state reconciliation;
- tenant isolation, immutable order evidence, and refunds.

We will present those as payments engineering, not as AI novelty. The AI-specific depth
is:

- translating intent into a typed, reviewable delegation;
- limiting which tools/effects a model can cause;
- cryptographically binding an agent to constraints and a checkout;
- measuring real models against adversarial merchant data;
- proving safety even when model behaviour is manipulated.

## Honest security claim

CONDUIT can stop manipulated model output from violating deterministic constraints. It
does not prove that the model chose the best product, that a merchant's structured
attributes are truthful, or that prompt injection cannot influence a choice within an
allowed set.

The evaluation report will therefore separate:

- **hard authorization safety:** overspend, wrong merchant, disallowed SKU, replay,
  cross-tenant access, and unauthorized payment effect;
- **decision quality:** preference satisfaction, ranking, and refusal quality;
- **steering:** whether attacker-controlled content changes a choice while remaining
  inside the authorized envelope;
- **source truth:** whether structured product claims were merchant-attested, imported,
  inferred, or independently verified.

The target for unauthorized effects is zero. The target for all behavioural influence
cannot honestly be zero.

## Execution order

### Gate 0 — close the existing product slice

Build only the durable order/receipt read model needed by payment, refund, and external
agent flows. Remove or relabel any demo copy that implies a real model, real payment, or
protocol conformance where none exists.

**Why first:** later external evidence needs one stable place to display order and
payment truth.

### Gate 1 — live-model benchmark

- Generalize the current model adapter only as far as needed for two independent
  providers.
- Freeze a versioned scenario manifest before running it.
- Include malicious descriptions, valid-but-steering descriptions, dishonest structured
  attributes, malformed tool output, constraint relaxation, repeated calls, and
  unsatisfiable requests.
- Run repeated guardrails-on/off trials and store redacted traces, exact model IDs,
  dates, latency, token usage, cost, outcomes, and scenario digests.
- Publish denominators. “Zero violations” without a run count is not evidence.

**Why before payment:** this is the smallest change that removes the “scripted AI” gap
and tells us whether the current agent/runtime abstractions survive real providers.

### Gate 2 — Razorpay Test Mode vertical slice

- Introduce payment sessions rather than forcing browser Checkout into the current
  synchronous `authorize()` abstraction.
- Create a Razorpay order from the durable outbox.
- Open Razorpay Checkout on the trusted buyer surface using test credentials only.
- Verify the checkout signature on the server before accepting the callback.
- Ingest signed webhooks idempotently and store provider event IDs.
- Reconcile unresolved states by provider lookup; never treat a timeout as a decline or
  blindly create another payment order.
- Exercise success, user failure, forged signature, duplicate webhook, delayed webhook,
  discarded response after provider acceptance, and refund.
- Store a dated evidence bundle with request/response fields redacted.

**Why second:** it turns the existing outbox and reconciliation story from a simulation
into provider-backed evidence without risking live money.

### Gate 3 — signed delegated authorization

- Specify a small, versioned authorization credential with issuer, subject, audience,
  merchant, currency, amount/category/SKU constraints, expiry, nonce, agent public-key
  confirmation, and checkout hash where closed.
- Publish rotating verification keys and retain key IDs.
- Verify signatures, claims, checkout binding, disclosure, revocation, remaining
  drawdown, and replay in deterministic code.
- Produce signed acceptance/rejection evidence and receipts.
- Map the result to AP2 v0.2 concepts, but keep the label “AP2-inspired” until exact
  conformance is demonstrated.

**Why third:** a PostgreSQL grant protects our own service; a signed credential begins
to answer why a separate merchant can trust a delegation.

### Gate 4 — independent agent and public deployment

- Deploy one reference merchant with HTTPS, production-style secret handling, health
  checks, migrations, backups, and an explicit non-production-money banner.
- Publish UCP discovery and verification-key endpoints.
- Use an external agent implementation or official sample that depends only on public
  contracts.
- Demonstrate human-present approval first, then autonomous execution under a narrow
  signed authorization.
- Export one evidence bundle linking model trace, mandate, checkout, provider events,
  order, refund if present, and audit-chain position.

**Why fourth:** interoperability is only credible when the client is independent and the
endpoint is reachable outside the developer laptop.

### Gate 5 — external use and communication

- Ask one external user to complete a test-mode purchase.
- Approach one small merchant only after the flow is stable; use a synthetic or test
  catalog until legal, tax, fulfillment, privacy, and support responsibilities are
  defined.
- Publish the benchmark table, failure analysis, architecture article, and short demo.
- Convert measured results into resume bullets only after the numbers exist.

## Work explicitly paused

Until Gates 1–4 pass, do not add:

- another commerce/payment protocol;
- another large console or dashboard;
- vector search or RAG;
- a generalized workflow engine;
- live-money support;
- broad merchant features unrelated to the reference flow;
- a SENTINEL runtime dependency.

SENTINEL can later contribute approval binding, Razorpay tool classification, redaction,
and adversarial cases. Deferring it prevents two overlapping policy/audit systems while
the simpler real-payment path is still unproven.

## Evidence ladder

Every claim shown in the UI, README, or resume must carry one level:

1. **MODELLED:** deterministic local double or scripted model.
2. **TESTED:** automated local/PostgreSQL invariant test.
3. **SANDBOX:** dated external provider or model call with evidence.
4. **INTEROPERABLE:** independent client passed a versioned public contract.
5. **PILOTED:** an external person or merchant used the deployed flow.

Higher levels do not erase lower-level tests; they answer different questions.

## Success definition

The next version is successful when we can truthfully say:

- at least two real model providers ran a repeated, prewritten adversarial benchmark;
- zero guardrails-on runs caused an unauthorized external effect, with the exact run
  count published;
- Razorpay Test Mode success, failure, timeout/reconciliation, webhook replay, and
  refund are demonstrated;
- a merchant can verify a signed authorization without reading CONDUIT's private
  database;
- an independently implemented agent completes the public reference journey;
- at least one external user has used the deployed test flow.
