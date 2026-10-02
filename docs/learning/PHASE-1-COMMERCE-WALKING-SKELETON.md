# Phase 1 Learning Note: The Commerce Walking Skeleton

## The result in one sentence

A deterministic buyer can now create a tenant and merchant, publish a versioned product,
build a server-priced cart, and commit exactly one modelled order in PostgreSQL.

It is called a **walking skeleton** because it is the thinnest complete path through all
important layers. It walks end to end, but it does not yet have every safety control or
product feature.

## What is built?

### Tenant and merchant boundaries

A tenant is the customer account using CONDUIT. A merchant is a shop inside that tenant.
Every product, price, inventory row, cart, and order carries tenant ownership.

Queries always include the tenant ID. Composite database foreign keys also prevent a
cart from one merchant from referencing a product owned by another merchant. Tests try
cross-tenant and cross-merchant access and receive structured `NOT_FOUND` errors.

This is application-level isolation plus database relationship enforcement. PostgreSQL
row-level security and authenticated users are not built yet.

### Versioned catalog truth

A product has two kinds of information:

- **Structured truth:** SKU, category, explicit attributes, price, stock, and currency.
- **Merchant prose:** display name and description. An agent may read these later, but
  they will be classified as untrusted text.

Prices are not overwritten. A change closes the old version and opens a new version at
the same exact PostgreSQL timestamp. This creates an explainable history:

```text
version 1: ₹199.00, valid until T
version 2: ₹225.00, valid from T, current
```

The database permits only one current price for a product.

### Off-rail cart

A cart stores only product identity and quantity. It does not store a client-supplied
price. Every read joins the cart to the current catalog price and calculates totals with
the exact `Money` type.

The boundary contract is strict: adding a line with a `price` field is rejected instead
of ignored. This matters because silently ignoring an agent's claimed price can make an
unsafe caller appear correct.

The cart supports create, add, update, remove, read, and commit.

### Transactional modelled commit

Commit performs this Phase 1 sequence inside one PostgreSQL transaction:

1. Lock the cart so concurrent commits serialize.
2. Return the existing order if the cart was already committed.
3. Load live catalog prices and lock inventory rows.
4. Reject an empty cart or insufficient stock.
5. Calculate line totals and the cart total on the server.
6. Decrement stock.
7. Create one order and immutable price-snapshot lines.
8. Mark the cart committed.
9. Commit everything together, or roll everything back together.

Repeating commit returns the first order. It does not decrement stock twice or create a
second order. Phase 2 will generalize this into a complete idempotency system with
operation keys and provider reconciliation.

### Immutable receipt snapshots

Order lines copy the SKU, display name, quantity, price version, unit price, and line
total used at commitment. If the catalog price changes later, the old receipt remains
unchanged. A receipt is historical evidence, not a live catalog view.

### Modelled provider seam

The `DeterministicModelledOrderProvider` returns a stable reference derived from the
cart ID. It makes the provider boundary visible without pretending money moved. Every
demo output says `MODELLED`.

This provider intentionally has no external side effect. A real provider cannot be put
inside the database transaction; Phase 2 will use durable outbox and reconciliation
patterns for that boundary.

## How the layers fit together

```text
Strict Zod input contract
          │
          ▼
CommerceService (use-case orchestration)
          │ depends on an interface
          ▼
CommerceRepository
          │ implemented by
          ▼
PostgresCommerceRepository → PostgreSQL 18.6

Domain Money / IDs / SKU / quantity rules are used across the flow.
```

The application layer does not know SQL. The domain does not know the application,
PostgreSQL, Docker, or AI. This dependency direction lets us replace an adapter without
rewriting the business rules.

## What the tests prove

- Exact server totals and versioned price history.
- Two concurrent commits create one order and decrement stock once.
- The same SKU may exist at two merchants without collision.
- Cross-tenant and cross-merchant reads/writes fail.
- Add, update, and remove all reprice on the server.
- Insufficient stock rolls back stock, cart status, and order creation together.
- A committed receipt does not change after the catalog price changes.
- A cart request containing a client/agent price is rejected at validation.

The live suite runs against PostgreSQL, not mocks.

## A bug the tests found

The first price-change implementation used a JavaScript `Date` as the boundary between
price versions. JavaScript stores milliseconds; PostgreSQL stores microseconds. The
rounded JavaScript time could be slightly earlier than the database-created start time,
violating the history constraint.

The fix was to close the old price and open the new one in one SQL statement using one
database-generated timestamp. The database now owns time precision where the database
constraint is evaluated.

## Run it

```bash
pnpm db:setup
pnpm demo:commerce
```

The output includes tenant, merchant, product, server-priced cart, and modelled order.

## What is deliberately not built yet?

- Human authentication or PostgreSQL row-level security.
- Spending mandates, policy decisions, approvals, or audit chaining.
- Stock reservations separate from final decrement.
- A real payment/order API, outbox, webhook, timeout reconciliation, or refund.
- The Phase 2 commit gate's stated-total comparison and itemized reprice diff.
- HTTP/MCP APIs, an AI buyer, storefront import, or user interface.

Those omissions are explicit so a modelled order is never mistaken for a real payment.
