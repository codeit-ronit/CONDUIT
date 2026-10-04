# ADR-0014: Put UCP checkout behind trusted buyer handoff

**Status:** Accepted  
**Date:** 2026-10-04

## Context

CONDUIT already has a safe canonical cart and trusted commit, while UCP defines an
external cart/checkout state machine. Copying commerce rules into the protocol adapter
would create two prices, two order paths, and inconsistent recovery. Letting an agent
call complete without buyer review would also exceed the current UCP rule when AP2
Mandates are absent.

## Decision

- Keep product, price, inventory, cart, authorization, ledger, order, and provider state
  in the existing domain/application/infrastructure layers.
- Make UCP a version-pinned validation and projection boundary.
- Bind every UCP cart and checkout to the authenticated principal, agent profile,
  tenant, and merchant in PostgreSQL.
- Treat cart updates as full atomic replacement so failure cannot leave a half-updated
  basket.
- Serialize each idempotency key with a PostgreSQL advisory transaction lock. Retain a
  canonical request digest and response for at least 24 hours; reject changed payloads.
- Give each cart at most one checkout. This makes cart-to-checkout conversion durable
  and naturally idempotent.
- Return `requires_escalation` plus `continue_url` until a buyer uses the trusted UI. An
  agent-side complete call is a read of current state, not authority to place.
- Derive the review token with a server secret, store only its SHA-256 digest, enforce
  expiry and same-origin approval, then call the existing trusted commit.
- Keep `payment_handlers` empty and label the payment provider MODELLED.

## Consequences

Protocol retries cannot silently change meaning, callers cannot fetch another
principal's cart by guessing an ID, and checkout does not bypass CONDUIT's strongest
rules. Order evidence remains in the same ledger/outbox path used everywhere else.

The adapter is intentionally incomplete for production: no official conformance run,
public TLS, production buyer identity, message signing, real payment handler,
fulfillment, tax, email, refund, or order API has been demonstrated.
