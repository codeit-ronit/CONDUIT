# Phase 7: Durable Order and Receipt Evidence

## What we built

A completed checkout now has one tenant-scoped read model named
`conduit.order-evidence.v1`. It combines:

- the immutable order and price-version line snapshots;
- the purchase operation and policy decision reason;
- the authorization grant used for the purchase;
- provider-outbox status and attempt count;
- append-only drawdown entries;
- inventory reservation state;
- a chronological, append-only effect timeline.

The trusted checkout page and the UCP visual scenario display this receipt after buyer
approval. The payment is still clearly labelled `MODELLED`; no Razorpay or bank has been
called.

## Why another event table is necessary

Current-state tables answer “where are we now?” An evidence timeline must also answer
“how did we get here?”

Before this slice, an outbox could change:

```text
PENDING → PROCESSING → UNKNOWN → DELIVERED
```

Afterwards only `DELIVERED` remained in the outbox row. The new stream records events
such as:

```text
ORDER_PREPARED
SPEND_RESERVED
PROVIDER_QUEUED
PROVIDER_ATTEMPTED
PAYMENT_UNKNOWN
PAYMENT_CONFIRMED (source: RECONCILIATION)
```

We did not turn the entire order into event sourcing. Existing tables remain the
authoritative current state. Events are appended transactionally to explain important
external-effect transitions.

## Consistency rule

The read model loads all related rows inside one PostgreSQL `REPEATABLE READ READ ONLY`
transaction. That prevents a receipt from combining, for example, a pre-confirmation
outbox state with post-confirmation ledger entries.

Queries are sequential on one PostgreSQL client. Starting them concurrently would not
create database parallelism on one connection and is deprecated by the `pg` driver.

## Idempotent evidence

Every timeline event has a stable `event_key`. If recovery reaches the same completion
path twice, the state transition remains idempotent and the evidence insert uses the
same key. It cannot create two “payment confirmed” claims for one effect.

## Security boundaries

- The root order query requires both tenant ID and order ID.
- Child rows are loaded only after that root exists.
- A different tenant receives `null`, not a clue that the order exists.
- A database trigger rejects event updates and deletes.
- Event payloads contain typed operational facts, not buyer contact details or payment
  secrets.

## Honest limitation

The receipt currently says `auditLink: NOT_LINKED`. The enforcement/tool audit chain and
the UCP checkout path do not yet share a durable correlation identity. Showing the
tenant audit head would look impressive but would falsely imply that it proved this
specific purchase.

The correct later fix is to carry a durable correlation/run ID through checkout,
purchase operation, boundary calls, provider effects, and receipt—not to attach an
unrelated hash after the fact.

## Evidence

- `pnpm check`: 79 tests across 21 files plus formatting, lint, typecheck, and build.
- `pnpm db:check`: all eight migrations apply idempotently; 32 PostgreSQL tests across
  eight files pass.
- Tests prove price-snapshot stability, tenant isolation, append-only enforcement,
  modelled-success evidence, and unknown-to-reconciled event ordering.

## Next step

Phase 8 runs the prewritten safety and steering scenarios repeatedly against real model
providers. The receipt is now ready to store the exact model/version/run evidence later,
but model traces remain a separate evidence type until their correlation contract is
designed.
