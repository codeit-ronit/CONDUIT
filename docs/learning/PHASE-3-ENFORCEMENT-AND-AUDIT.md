# Phase 3: Enforcement Boundary and Audit

## The simple idea

Phase 2 made purchase commit safe. Phase 3 makes **every tool action** pass through the
same visible checkpoint.

An AI model cannot directly change a cart, create an order, send a message, or call a
provider. It can only propose a tool call. That gives CONDUIT one dependable place to
enforce rules:

```text
model proposes a call
        ↓
discover live tools
        ↓
compare approved schema snapshot
        ↓
validate arguments and run permission
        ↓
write audit DECISION
        ↓
forward or block
        ↓
write audit OUTCOME
```

This applies the KT document's core thesis: we cannot guarantee that a model is never
fooled, but we can make being fooled harmless.

## Why this is separate from the agent

The future agent loop will read attacker-influenced merchant text. A check inside that
loop shares the compromised context. The `@conduit/enforcement` package instead owns one
interceptor outside the model loop. The agent cannot edit its policy, approvals, run
state, or audit history.

## Runtime discovery and approved snapshots

CONDUIT does not assume that yesterday's provider tools still describe today's runtime.
It asks the adapter for the live tools and compares each exact input/output schema hash
with a PostgreSQL approval.

| Reconciliation result | Boundary behavior                                      |
| --------------------- | ------------------------------------------------------ |
| `APPROVED`            | Continue to argument and permission policy             |
| `UNKNOWN`             | Deny until an operator reviews the tool                |
| `SCHEMA_DRIFT`        | Deny until the changed schema is explicitly reapproved |
| discovery fails       | Deny because the boundary always fails closed          |

Classification also comes from the approved record, not from the provider:

- `READ_ONLY`;
- `REVERSIBLE_WRITE`;
- `BINDING_WRITE`;
- `EXTERNAL_EFFECT`.

That matters because a provider must not be allowed to label its own dangerous tool as
harmless.

## Trust labels and quarantine

Phase 3 makes the source of information explicit:

- `OPERATOR`: the human's instruction;
- `TOOL_STRUCTURED`: typed IDs, prices, stock, currencies, and status values—trusted as
  data, never instructions;
- `UNTRUSTED_PROSE`: product descriptions, names, and merchant notes.

Untrusted prose is wrapped with a fresh random marker for every run:

```text
<CONDUIT_UNTRUSTED_random-run-nonce>
merchant text here
</CONDUIT_UNTRUSTED_random-run-nonce>
```

A fresh marker prevents a merchant from knowing the closing delimiter in advance. This
is still only a mitigation; a model may behave differently after reading malicious text.

## Permission narrowing—the structural defense

The durable run begins `CLEAN`. Once untrusted prose is returned, PostgreSQL records it
as `QUARANTINED`.

After that:

- reads continue;
- reversible cart changes continue;
- binding writes and external effects return `REQUIRE_APPROVAL`;
- a human can approve one exact typed call;
- the entire run does not become trusted again.

This preserves usable shopping while preventing merchant prose from silently reaching an
expensive effect.

## Central PII tokenization

`@conduit/observability` tokenizes sensitive values before responses and audit writes.
It handles:

- known values registered at run creation, such as a person's name;
- sensitive JSON keys such as email, phone, name, address, card, token, and secret;
- email, phone, and payment-number patterns inside free text;
- correlation metadata and runtime error payloads.

The same raw value maps to the same opaque session token, such as `<EMAIL_1>`. The raw
mapping remains only in memory. This is useful for the demo, but production needs an
encrypted and narrowly authorized token vault.

## Gapless hash-chained audit

Every proposed call gets two entries:

1. `DECISION`: what policy decided before execution;
2. `OUTCOME`: blocked, succeeded, or failed.

Each entry includes a correlation ID, tool classification, reason code, policy version,
context fingerprint, previous hash, and its own hash.

PostgreSQL locks one tenant audit head while allocating the next number. That produces a
gapless sequence even when calls finish concurrently. A database trigger rejects normal
updates and deletes.

PostgreSQL calculates the stored hash; Node independently recalculates and verifies the
chain. During implementation, the concurrency test found that the reader sorted text as
`1, 10, 11, 2`. The database entries were correct, but the viewer was not. Sorting the
original bigint fixed it. This is a useful example of why the viewer and verifier need
independent evidence.

### Honest limitation

The chain is tamper-evident, not tamper-proof. A database owner can disable the trigger
and recompute the chain. External anchoring to a transparency service or write-once
storage is required for tamper resistance and is not implemented.

## The upgraded Trust Lab

Run:

```bash
pnpm db:up
pnpm db:migrate
pnpm demo:web
```

Open <http://127.0.0.1:4310>. The interface now has two clear workspaces:

- **Purchase safety:** all Phase 2 commerce and payment scenarios;
- **Tool boundary:** seven Phase 3 scenarios.

The Phase 3 scenarios show:

1. structured data versus quarantined prose;
2. permission narrowing after untrusted content;
3. one-call human approval;
4. an unknown tool denied;
5. schema drift denied;
6. PII tokenized on output and audit surfaces;
7. concurrent calls producing a gapless verified chain.

The UI exposes trust-state changes, discovery status, whether a call was forwarded,
stable reason codes, provenance labels, audit sequence, short hash links, privacy
status, and exact JSON for technical inspection. External effects remain labelled
`MODELLED`.

## Evidence

```bash
pnpm check
pnpm db:check
```

- 43 pure/unit tests pass.
- 19 live PostgreSQL tests pass.
- Ten concurrent calls create exactly 20 ordered audit entries.
- Every call has one decision and one outcome.
- Unknown and changed tools have zero executions.
- Seeded names, emails, phone numbers, and correlation metadata appear on no tested
  response or audit surface.
- Normal audit updates and deletes are rejected.
- All seven Phase 3 demo APIs were executed and independently verified their chains.

## What comes next

Phase 4 adds the bounded AI buyer above this boundary: typed intent confirmation, an
explicit state machine, step/time budgets, loop detection, structured model output, and
the same scenarios across scripted, flawed, and live-model adapters. The model will gain
reasoning ability, but no new authority.
