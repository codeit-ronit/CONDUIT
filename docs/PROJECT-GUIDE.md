# CONDUIT Project Guide

**Status:** living document **Last updated:** 2026-10-02 **Source material:**
`CONDUIT-KT.md`, independently checked research, and new design decisions recorded in
this repository.

## 1. What problem are we solving?

A human can inspect a storefront, compare products, and approve checkout. An AI agent
needs structured data and APIs. Once we give it those APIs, it can also make costly
mistakes: misunderstand a request, trust malicious product text, use an old price,
repeat a timed-out payment, or spend outside the user's intent.

CONDUIT lets a person give an agent a narrow, revocable permission such as:

> Buy vegetarian dinner for four from merchant M, for at most ₹2,000, before 9 p.m.
> today.

The agent can shop freely inside that envelope. It cannot turn its own words into a
charge. Code outside the model checks the merchant, expiry, currency, items, live price,
stock, cumulative spend, and operation identity before an external action occurs.

## 2. Who is the product for?

The initial customer is a small or medium merchant that already has a website or
spreadsheet but no agent-commerce engineering team. The product has two sides:

- **Merchant side:** import a catalog, expose safe machine-readable commerce, receive
  orders, and see why an action was allowed or refused.
- **Buyer side:** delegate a constrained purchase to an agent and receive a receipt that
  links intent, checkout, authorization, policy, and payment.

The product is not “an AI shopping chatbot.” The sellable part is the trust and
interoperability layer that makes many shopping agents safe enough to transact with many
merchants.

## 3. Core thesis

Prompts influence model behaviour; they do not guarantee it. A guarantee must live where
a proposed tool call becomes a real-world effect.

We split the system into two worlds:

| World           | May be probabilistic? | Examples                                                   |
| --------------- | --------------------: | ---------------------------------------------------------- |
| Proposal world  |                   Yes | interpreting intent, ranking products, explaining choices  |
| Authority world |                    No | prices, totals, constraints, stock, authorization, payment |

This is why a weak model and a strong model should produce different shopping quality
but the same safety result.

## 4. What we keep from the old project

These ideas are load-bearing and survive the rebuild:

1. An off-rail, mutable cart and one explicit commit point.
2. Server-side repricing immediately before commitment.
3. Integer minor units for all money.
4. A scoped, expiring, revocable spending authorization.
5. Reserve-before-forward and reconcile-before-retry.
6. A pure, fail-closed policy engine with structured refusal reasons.
7. Idempotency, append-only money events, and a tamper-evident audit chain.
8. Untrusted merchant prose is data, never authority.
9. Evaluation with hard-zero safety gates and red-team ablations.
10. Honest labels: **real**, **modelled**, or **referenced**.

## 5. What we deliberately change

The rebuild fixes known weaknesses rather than reproducing them:

- Database transactions and uniqueness constraints replace process-local locks.
- Tenant identity and merchant authorization exist from the first vertical slice; they
  are not postponed until “production.”
- Our domain model is stable and provider-neutral. MCP, UCP, ACP, AP2, and each payment
  provider are adapters, because their specifications change.
- Event sourcing is used only where its audit value is high (authorization drawdowns),
  not as a fashionable default for all data.
- A durable outbox records external work so crashes between a database commit and a
  provider call are recoverable.
- Natural-language intent is compiled into typed constraints and shown to the human
  before authorization. The natural-language sentence itself is not an executable
  policy.
- The audit chain is described as tamper-evident. External anchoring is a later feature
  and no stronger claim is made before it exists.

## 6. Where AI/ML belongs

“Advanced AI” means using models where uncertainty is useful, then measuring them. It
does not mean putting a model in every component.

### In V1

- Parse a user's request into a typed purchase-intent proposal.
- Rank valid products after deterministic filters apply.
- Produce a tool-use plan through schema-constrained output.
- Explain selections and structured refusals in simple language.
- Run strong and deliberately flawed agent variants through the same eval set.

### Not in the authority path

- Adding money, deciding the binding price, evaluating a spending cap, reserving stock,
  deciding idempotency, and charging a payment method.
- Product exclusions such as allergens or “no beef.” Those use explicit attributes and
  deterministic filtering, not semantic similarity.
- Detecting whether a call is safe. Classifiers can add risk signals, but a classifier
  miss must never grant permission.

### Later, only after a measured need

- Hybrid retrieval for messy catalog discovery.
- Evidence-grounded dispute drafting.
- Merchant spreadsheet-column inference and product attribute enrichment, each with
  human confirmation and provenance.

## 7. V1 product promise

For one buyer, one selected merchant, and one authorized task, V1 will complete a
sandbox purchase and prove all of the following:

- the charged amount came from current catalog data;
- the charge was within a typed, active authorization;
- a repeated commit did not create a second order or charge;
- a timeout caused reconciliation, not blind retry;
- malicious merchant prose could alter the agent's reasoning but could not create an
  unauthorized external effect;
- the receipt and audit view explain what happened and why.

V1 supports multiple tenants and merchants in its data model, even if the demo journey
uses one of each. This makes scope checks real rather than comparisons against the same
global constant.

## 8. Non-goals for V1

- Real card custody, production settlement, refunds, discounts, subscriptions,
  cross-border tax, shipping optimization, or marketplace payouts.
- Claiming conformance with UCP, ACP, or AP2 before their official conformance suites
  pass.
- Claiming prompt injection is solved.
- Microservices, Kubernetes, or a vector database without measured need.
- Fully autonomous arbitrary-web shopping.

## 9. How we will learn while building

Each implementation step will be explained with the same five questions:

1. **What are we building?** The visible behaviour.
2. **Why does it exist?** The failure it prevents or value it creates.
3. **How does it work?** The data flow and important code, in plain language.
4. **How do we know it works?** Tests, traces, and observable evidence.
5. **What are its limits?** What we intentionally did not solve.

Before a major slice, its concepts will be added to this guide or a focused learning
note. After the slice, the project log will record what actually happened, including
failed ideas. Important choices receive a decision record.

## 10. Success measures

Safety gates must remain exactly zero:

- unauthorized external effects;
- charges above authorization;
- duplicate charges for one operation;
- cross-tenant reads or writes;
- PII in prompts, traces, audit events, or model-visible errors.

Quality measures may improve over time:

- task completion rate;
- constraint satisfaction rate;
- refusal recovery rate;
- catalog import coverage and correction rate;
- latency and cost per completed task;
- human comprehension of the receipt and audit explanation.
