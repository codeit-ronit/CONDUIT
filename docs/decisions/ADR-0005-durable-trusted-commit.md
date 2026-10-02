# ADR-0005: Durable trusted commit with reservations and an outbox

**Status:** accepted  
**Date:** 2026-10-02

## Context

A database transaction cannot include a payment provider's network and database. If we
change stock in PostgreSQL and then call a provider, the process may crash between the
two systems. Pretending both changes are one atomic operation creates either lost work
or duplicate charges.

The trusted commit must also stop two concurrent carts from jointly exceeding one
authorization, and it must tell bad arithmetic apart from a genuine catalog price
change.

## Decision

Use an ordered, PostgreSQL-backed commit gate:

1. Lock the cart and authorization grant.
2. Reprice the cart from current versioned catalog rows.
3. Evaluate a pure, versioned policy against the claimed and live quotes.
4. In one transaction, reserve inventory, append a `RESERVE` drawdown, create a pending
   order, and write a provider command to an outbox.
5. After that transaction commits, a worker claims the durable command and calls the
   provider with the purchase operation key as its idempotency identity.
6. Definite success appends `CONFIRM`; definite decline appends `RELEASE` and returns
   stock; an ambiguous response remains `PAYMENT_UNKNOWN`.
7. Unknown results use provider lookup. They never repeat authorization blindly.

Outbox claims use a 30-second lease. A crashed worker's stale `PROCESSING` command can
be reclaimed with the same idempotency key. Completion is itself transactional and
idempotent.

## Consequences

- A process crash after preparation cannot lose provider work.
- Concurrent spending is serialized by the locked grant and append-only exposure.
- There are visible intermediate states: `COMMITTING`, `PENDING_PROVIDER`, and
  `PAYMENT_UNKNOWN`. These are truthful, useful states—not errors to hide.
- Provider adapters must support idempotency and state lookup before they can be called
  production-ready.
- The current provider is explicitly MODELLED. No real money moves.

## Rejected alternatives

- **Call the provider inside the SQL transaction:** a long network call holds locks and
  still cannot make two systems atomic.
- **Retry every timeout as a failure:** the first call may have succeeded, so this can
  duplicate a charge.
- **Store only a mutable amount-used counter:** it loses the history needed to explain,
  reconcile, or reverse decisions.
