# UCP 2026-08-25 cart and checkout research

**Checked:** 2026-10-04  
**Claim:** referenced contract plus a tested local partial implementation; public
conformance is not claimed.

## What the current specification says

- Cart capability is `dev.ucp.shopping.cart`. Its REST operations are create, get,
  full-replacement update, and cancel.
- Checkout capability is `dev.ucp.shopping.checkout`. Its REST operations are create,
  get, update, complete, and cancel.
- Money amounts are integer minor units. The business remains authoritative for price.
- A checkout created with `cart_id` uses the cart contents and ignores overlapping
  request fields. Repeated conversion of one cart must resolve to the existing active
  checkout.
- Mutable operations support `Idempotency-Key`: the same key and same payload returns
  the stored result; the same key with a different payload returns HTTP 409. Results
  must be retained for at least 24 hours.
- Checkout status is a state machine. `requires_escalation` means the platform must
  inspect messages and hand the buyer to `continue_url`.
- Without AP2 Mandates, an agent may help prepare checkout but must hand final review
  and order placement to a trusted, deterministic buyer UI.
- Public REST endpoints require HTTPS with TLS 1.3. Local HTTP cannot be called a
  conforming deployment.
- Every REST request carries the structured `UCP-Agent` field in the form
  `profile="https://platform.example/.well-known/ucp"`; credentials are bound to that
  declared identity before resource access.

## Design consequence for CONDUIT

We use the canonical cart and trusted-commit workflow; we do not create a second UCP
commerce engine. The adapter maps product IDs and quantities into server-priced carts.
Checkout initially returns `requires_escalation` with a signed handoff link. Calling the
protocol `complete` operation before buyer review does not place the order. The trusted
browser approval invokes the existing live-reprice, authorization, policy, stock,
drawdown, order, outbox, and provider workflow.

The discovery profile now advertises cart and checkout because the local surface has
create/get/update/cancel cart and create/get/update/complete/cancel checkout paths.
`payment_handlers` remains empty: the provider is modelled and no external money moves.

## Primary sources

- [Cart overview](https://ucp.dev/2026-08-25/specification/shopping/cart/)
- [Cart REST binding](https://ucp.dev/2026-08-25/specification/shopping/cart/rest/)
- [Cart schema](https://ucp.dev/2026-08-25/schemas/shopping/cart.json)
- [Checkout overview](https://ucp.dev/2026-08-25/specification/shopping/checkout/)
- [Checkout REST binding](https://ucp.dev/2026-08-25/specification/shopping/checkout/rest/)
- [Checkout schema](https://ucp.dev/2026-08-25/schemas/shopping/checkout.json)

## Deliberate limits

- The local request schemas implement the V1 fields CONDUIT supports; official schema
  conformance and every extension are not yet proven.
- Links and the buyer identity are demo values. Production needs real legal URLs,
  production identity, confirmation email, TLS 1.3, signed messages, and credential
  lifecycle.
- No UCP payment handler, AP2 mandate, shipping, tax, discount, refund, or production
  order service is claimed.
