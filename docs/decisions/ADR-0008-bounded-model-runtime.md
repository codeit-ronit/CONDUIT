# ADR-0008: Models propose; a bounded runtime and trusted tools decide

**Status:** accepted

**Date:** 2026-10-02

## Context

An LLM is useful for turning a human request into constraints and choosing among valid
options. It is not reliable enough to own permissions, arithmetic, termination, or a
binding purchase. Prompt instructions alone cannot guarantee those properties, and
different models will fail differently.

We also need offline tests, deliberate failure experiments, and a real-model path
without maintaining three different shopping systems.

## Decision

- Put all model providers behind one small `BuyerModel` strategy interface:
  `proposeIntent` and `nextAction`.
- Validate every provider response against strict, versioned Zod contracts. Unknown keys
  fail validation.
- Require the human to confirm the exact SHA-256 fingerprint of the typed intent before
  any catalog tool is called.
- Run confirmed intent through an explicit state machine with step, wall-clock, and
  repeated-action limits.
- Filter category, stock, total budget, required attributes, and excluded SKU terms in
  deterministic code before the model sees candidates.
- Keep merchant names/descriptions outside the ranking context in this V1 slice. The
  boundary still quarantines and audits that prose, but the model receives only
  structured candidates plus the fact that untrusted text was observed.
- Let the model state the total it believes it saw, but never trust it. The existing
  commit gate compares that claim with live server arithmetic before an effect.
- Route `catalog.search`, `cart.set_line`, `cart.review`, and `purchase.commit` through
  the same Phase 3 boundary.
- Provide scripted, deliberately flawed, and OpenAI Responses API adapters. A provider
  swap does not change tools or authority.
- Use OpenAI Structured Outputs with strict JSON Schema and validate again locally.
  Handle incomplete output and refusal as failures, not partial success.

## Consequences

- Tests are deterministic and free with the scripted adapter.
- A deliberately bad model can exercise safety controls without being given a special
  code path.
- An agent cannot silently relax a confirmed budget or quantity.
- A looping model consumes a small known budget and then terminates.
- The live adapter requires `OPENAI_API_KEY` and `OPENAI_MODEL`; without both, the demo
  says `NOT_CONFIGURED` rather than pretending a real call happened.
- The current confirmation state is carried by the request/demo process. Durable agent
  sessions, resumable approval, and multi-replica ownership are not implemented yet.
- SKU-based excluded-term filtering is intentionally conservative and incomplete. Phase
  5's reviewed structured catalog enrichment will improve product semantics.

## Rejected alternatives

- **Prompt-only guardrails:** they ask the same fallible model to enforce its own
  authority.
- **Let the model call application services directly:** this bypasses schema approval,
  permission narrowing, and audit.
- **One implementation per model provider:** safety behavior would drift between
  adapters.
- **Unlimited autonomous loop:** a repeated or adversarial response could run forever
  and create unbounded cost.
- **Trust Structured Outputs without local validation:** transport/provider guarantees
  do not replace validation at our own boundary.
