# Phase 2: Trust Kernel

## The simple idea

Phase 1 proved that CONDUIT can calculate a cart and create one correct order. Phase 2
answers a more important question:

> Even if the cart is technically valid, is this exact purchase allowed by the buyer?

The answer no longer comes from the AI agent. It comes from typed authorization, pure
rules, exact arithmetic, database locks, and an append-only ledger.

## What is now built

### 1. Typed authorization grant

A grant says exactly what the buyer permits:

- tenant and buyer identity;
- one merchant and one currency;
- maximum cumulative amount;
- optional category and SKU allow-lists;
- expiry and revocation state;
- policy version (`trust-v1`).

This is safer than a sentence such as “buy me dinner under ₹1,000.” The sentence may
help create a proposed grant, but only confirmed typed fields become authority.

### 2. Claimed quote versus live quote

Commit receives the itemized quote the caller believes it saw. CONDUIT independently
reloads current product rows and builds a live quote.

| Situation                                     | Result             | Why                                         |
| --------------------------------------------- | ------------------ | ------------------------------------------- |
| `quantity × unit price` is internally wrong   | `DENY`             | The caller's arithmetic cannot be trusted   |
| Old quote is correct, but live price is newer | `REQUIRE_APPROVAL` | The buyer should see and accept the change  |
| Quote is current and every grant rule passes  | `ALLOW`            | The purchase may enter the reservation flow |

This prevents a normal merchant price update from being mislabeled as an attack, while
still refusing invented totals.

### 3. Pure policy engine

`evaluatePurchasePolicy` receives all facts as input. It does not read the clock,
database, network, environment, or an AI model. That makes a decision repeatable and
easy to test.

It checks arithmetic, tenant, merchant, revocation, expiry, currency, categories, SKUs,
remaining authorization amount, and live price versions. Every result contains an
outcome, stable reason code, human explanation, and recovery action.

### 4. Append-only drawdown ledger

We do not overwrite a single “spent” number. We append events:

```text
RESERVE → CONFIRM
RESERVE → RELEASE
RESERVE → CONFIRM → REVERSE (supported ledger state for a later reversal workflow)
```

`RESERVE` immediately consumes available permission while a provider result is pending.
`CONFIRM` does not consume it a second time. `RELEASE` and `REVERSE` return capacity.

### 5. One safe reservation transaction

The same SQL transaction holds stock, appends the drawdown reserve, creates the purchase
operation and pending order, moves the cart to `COMMITTING`, and writes a durable outbox
command. If any statement fails, PostgreSQL rolls all of them back.

### 6. Idempotency

Every purchase has an operation key. Inside one tenant, that key maps to one operation.
If the request arrives twice, the second call returns the original operation instead of
creating another order or provider command. Correctness therefore survives retries,
worker restarts, and double-clicks.

### 7. Durable outbox and recovery

PostgreSQL and a payment provider cannot share one transaction. The outbox bridges the
gap:

```text
Database transaction                 Worker / provider
────────────────────                 ─────────────────
reserve stock
reserve grant amount
create pending order
write PENDING command  ────────────► claim command
commit                               call provider with operation key
                                     save success / decline / unknown
```

A worker claim is a 30-second lease. If the worker dies, another worker can recover the
stale command with the same provider idempotency key.

### 8. Unknown is a real state

A timeout does not mean “payment failed.” The provider may have acted before the reply
was lost. CONDUIT stores `PAYMENT_UNKNOWN`, keeps both reservations, and queries
provider state. It does not authorize again.

## The live Trust Lab

```bash
pnpm db:up
pnpm db:migrate
pnpm demo:web
```

Open <http://127.0.0.1:4310>. The lab runs real application and PostgreSQL code for six
scenarios: authorized purchase, wrong arithmetic, live price change, limit exceeded,
unknown provider result with reconciliation, and concurrent duplicate request.

The UI marks every external payment effect `MODELLED`. It shows the caller quote, server
quote, ordered gates, reason code, stock reservation, outbox state, and ledger.

## How to verify it

```bash
pnpm check
pnpm db:check
```

`pnpm db:check` creates and resets only `conduit_test`; it does not clear the normal
`conduit` demo database. The live tests prove concurrent spend protection, idempotency,
durable preparation, stale-worker recovery, decline release, and unknown reconciliation.

## Deliberate limits

- The provider is deterministic and MODELLED; no bank or payment processor is called.
- Authentication and user login are not built yet.
- A production refund/reversal use case is not exposed yet, although the ledger model
  and database entry type include `REVERSE`.
- The audit chain and universal tool interceptor belong to Phase 3.
- The AI buyer belongs to Phase 4. Financial authority remains deterministic.
