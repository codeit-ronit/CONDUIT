# Phase 4: Bounded AI buyer

## The simple mental model

The AI is a **planner**, not an authority.

It may say:

> “Choose product A, quantity 2, then request checkout.”

It may not decide:

- whether that product is inside the confirmed request;
- what the product costs;
- whether the buyer is authorized;
- whether a tool may run;
- how long the loop may continue; or
- what amount is finally charged.

Those decisions remain in deterministic code built in Phases 0–3.

## What we built

### 1. One provider-neutral model seam

`BuyerModel` has only two operations:

1. convert natural language into a typed intent proposal;
2. propose one next action from a bounded context.

Three strategies implement it:

- `ScriptedBuyerModel` gives repeatable offline behavior;
- `FlawedBuyerModel` deliberately emits bad schemas, wrong totals, or loops;
- `OpenAIResponsesBuyerModel` uses the Responses API and strict Structured Outputs.

The runtime does not know which provider it is using. More importantly, providers do not
receive different permissions.

### 2. Two-step intent confirmation

The model proposes a versioned object containing merchant, currency, maximum spend,
category, quantity, excluded terms, required attributes, and a readable summary.

CONDUIT canonicalizes that object and hashes it. Tool execution starts only when the
confirmation fingerprint exactly matches. Changing even one constraint produces a
different fingerprint.

This prevents a vague sentence from becoming hidden authority. The user confirms what
the system will actually enforce.

### 3. A visible state machine

The runtime moves through explicit states:

```text
AWAITING_INTENT_CONFIRMATION
            │ exact fingerprint
            ▼
        FILTERING ── no valid product ──► REFUSED
            │
            ▼
         CHOOSING ── invalid output/loop/budget ──► FAILED
            │
            ▼
       CART_READY
            │ server recomputes total
            ▼
        COMMITTING ── policy/quote denial ──► REFUSED
            │
            ├── narrowed permission ──► REQUIRES_APPROVAL
            ▼
         SUCCEEDED
```

Each transition creates a user-visible event. A run has at most six model steps, 15
seconds, and two identical repeated actions. These are application limits; the model
cannot ask to increase them.

### 4. Deterministic filtering before model ranking

Code removes products that violate category, stock, total budget, required attributes,
or excluded SKU terms. Only surviving structured candidates reach the model.

This matters because filtering is a rule, while ranking is a preference:

- “must be vegetarian” is enforced by code;
- “which valid vegetarian option looks best” may use a model.

The current model context excludes merchant prose entirely. The tool boundary still
quarantines and audits descriptions, making the run `QUARANTINED`, but unsafe text has
no reason to enter the ranking prompt in this slice.

### 5. Real tools behind the enforcement boundary

The demo does not use a fake cart. It creates a fresh PostgreSQL tenant, merchant,
products, buyer, grant, and cart. The agent's four tools are:

| Tool              | Classification   | Owner of truth                         |
| ----------------- | ---------------- | -------------------------------------- |
| `catalog.search`  | Read only        | versioned PostgreSQL catalog           |
| `cart.set_line`   | Reversible write | commerce service                       |
| `cart.review`     | Read only        | server-priced cart                     |
| `purchase.commit` | Binding write    | trust kernel, ledger, outbox, provider |

Every call is discovered, schema-reconciled, argument-validated, permission-checked, and
audited by Phase 3. Because the catalog carries merchant prose, the binding commit first
encounters permission narrowing and needs an explicit one-call human approval.

### 6. The wrong-total experiment

The deliberately flawed model builds a valid cart worth ₹398.00 and then states that the
total is one minor unit (₹0.01).

The action schema is valid, so the request reaches the real commit gate. The gate
independently recomputes line arithmetic and responds with `QUOTE_ARITHMETIC_MISMATCH`.
No order/provider effect is created and nothing is charged.

This is stronger evidence than preventing the model from making a mistake. It shows that
model mistakes do not become money mistakes.

## What Structured Outputs does—and does not do

The OpenAI adapter sends a strict JSON Schema. This makes provider output predictable
enough to parse, and the application validates it again with Zod.

Structured output solves **shape**, not **truth**. A perfectly shaped action may still
select the wrong item, state the wrong total, or repeat forever. The deterministic
filters, budgets, tool boundary, and commit gate handle those separate problems.

## Evidence from this slice

- 52 pure tests pass across 11 files.
- 19 live PostgreSQL tests from earlier phases still pass.
- Scripted scenario: five intercepted calls, seven runtime events, confirmed ₹398.00,
  verified audit chain.
- Wrong-total scenario: five intercepted calls, `QUOTE_ARITHMETIC_MISMATCH`, no charge,
  verified audit chain.
- Malformed-intent scenario: strict validation failure and **zero tool calls**.
- Loop scenario: stopped on the third identical proposal; no commit.
- Unsatisfiable ₹1.00 scenario: only catalog read, then refusal with no relaxed rule.
- The OpenAI adapter runs through the same contract in tests using an injected fake
  transport. A real network run remains explicitly unverified until credentials are
  configured.

## Honest limitations

- The live OpenAI adapter is implemented but has not been called with the user's
  credentials. The UI says `NOT_CONFIGURED` when they are absent.
- Agent sessions are not durable or resumable across a process restart.
- The demo scenario confirms intent programmatically and displays the exact confirmed
  fingerprint. A production buyer screen needs a separately authenticated confirmation
  endpoint and durable session record.
- Model token/cost budgets and cancellation accounting are not yet persisted.
- Product understanding uses existing structured attributes. Phase 5 will add reviewed
  merchant onboarding and provenance rather than asking the buyer model to scrape
  arbitrary pages.

## How this moves us toward the goal

Before Phase 4, CONDUIT could safely process a purchase but no AI selected the cart. Now
interchangeable models can perform the selection loop while every important guarantee
stays outside them. This is the first complete proof of the thesis:

> Agent quality may vary. Enforcement quality must not.

Phase 5 will make this useful to merchants by turning real catalog sources into the
structured, provenance-carrying data this buyer needs.
