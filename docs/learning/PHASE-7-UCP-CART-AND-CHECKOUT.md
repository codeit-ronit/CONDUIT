# Phase 7, slice 4: UCP cart and checkout

## What did we build?

An authenticated shopping surface now takes a platform from product IDs to a
server-priced cart, then to a durable checkout. It can create, read, replace, and cancel
carts; create, read, update, complete, and cancel checkout sessions; and safely replay
mutating requests.

The important part is what it refuses to do: the agent does not place the order. The
checkout first becomes `requires_escalation`, which means “send the buyer to the trusted
review screen.” Only that screen invokes CONDUIT's purchase gates.

```text
platform product IDs + quantities
              ↓
authenticated, merchant-scoped UCP cart
              ↓ server loads live price
durable checkout: requires_escalation
              ↓ continue_url
trusted buyer review and approval
              ↓
live reprice → authorization → stock → ledger → policy → outbox
              ↓
completed checkout + immutable order ID
```

## Why not let the agent complete it?

An AI recommendation is not buyer authorization. The current UCP specification says that
without AP2 Mandates, final review and order placement must happen in a trusted,
deterministic UI. The handoff makes that authority boundary visible and testable.

## What does idempotency mean here?

Networks retry. If the platform times out after creating a cart, it may send the same
request again. CONDUIT stores:

- the authenticated principal and operation;
- the idempotency key;
- a SHA-256 digest of canonical request JSON;
- the HTTP result and response JSON.

The same key plus the same body gets the cached result. The same key plus a changed body
gets 409 Conflict. A PostgreSQL advisory lock serializes concurrent use of the key.

## Why atomic cart replacement?

UCP update-cart is full replacement. We delete old lines and insert every new line in
one database transaction. If one product is invalid, PostgreSQL rolls back everything,
so the buyer never sees a half-old, half-new cart.

## What is real and what is modelled?

- **Real local:** authentication binding, merchant scope, prices, cart, checkout,
  idempotency records, authorization, policy, inventory reservation, drawdown ledger,
  order, outbox, and tests in PostgreSQL.
- **Modelled:** the payment provider. No Razorpay, card network, bank, or real money is
  involved.
- **Referenced:** UCP 2026-08-25 shapes and lifecycle.
- **Not claimed:** official UCP conformance or production readiness.

## Evidence

- Pure tests cover protocol projection, money, and buyer-handoff messages.
- PostgreSQL integration runs the complete cart → retry → conflict → checkout → blocked
  agent completion → two concurrent buyer approvals → one completed order flow.
- The suite now passes 79 pure tests and 31 PostgreSQL tests.
- The live UCP + MCP tab shows every transition and the claim boundary.
- The generated `continue_url` opens a dedicated Content-Security-Policy-protected,
  no-store buyer page that shows server-priced lines and owns the approval button.

## What comes next?

Add a durable order read model with production identity design, then research a real
payment sandbox separately. A provider should be called real only after credentials,
webhook/reconciliation behavior, failure cards, refunds, and dated live evidence are
available.
