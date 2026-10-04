# ADR-0016: Build receipts from an append-only order evidence stream

**Status:** Accepted  
**Date:** 2026-10-05

## Context

The order, purchase operation, provider outbox, inventory reservation, and drawdown
ledger already held the current checkout facts. They did not preserve every provider
transition: for example, an outbox row that moved from `UNKNOWN` to `DELIVERED` retained
only its final state. That is insufficient for proving how a timeout was recovered or
how a later webhook/refund affected the order.

The separate tool audit chain cannot be claimed as order evidence yet because UCP buyer
approval currently calls the trust service directly and the purchase operation stores no
audit run/call identity.

## Decision

- Add `order_evidence_events`, scoped by tenant, order, and purchase operation.
- Append events in the same database transaction as the state change they describe.
- Give every event a stable `event_key`; repeated completion/reconciliation paths use
  `ON CONFLICT DO NOTHING` instead of duplicating evidence.
- Reject update and delete operations with a database trigger.
- Read the receipt under one `REPEATABLE READ READ ONLY` transaction so order, line,
  authorization, ledger, inventory, outbox, and timeline rows represent one database
  snapshot.
- Preserve mutable tables as the efficient current-state projection. The event stream
  explains transitions; it is not a second order state machine.
- Backfill existing trusted orders with explicitly labelled migration events.
- Report the tool-audit link as `NOT_LINKED` until a durable correlation is added.

## Consequences

The browser and evaluation surface can show a stable order timeline today, and future
Razorpay callbacks, reconciliation results, and refunds have one append-only place to
attach evidence. Tenant scope is checked in the root query before child facts are read.

The stream is tamper-resistant only against ordinary application updates/deletes; a
database administrator can still rewrite the database. It is not a replacement for the
hash-chained tool audit or a future external anchor.
