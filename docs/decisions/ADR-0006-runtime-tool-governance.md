# ADR-0006: Runtime tool discovery with approved snapshots and permission narrowing

**Status:** accepted  
**Date:** 2026-10-02

## Context

CONDUIT's central claim is that every real action crosses one enforcement boundary. A
hardcoded tool list cannot uphold that claim: providers add tools, schemas drift, and an
adapter may expose a capability we did not expect. Trusting the provider's own risk
classification would also let the party being governed classify itself.

Merchant prose is an unavoidable untrusted input. Quarantine markers may help a model
recognize it as data, but prompt injection is not solved by a delimiter.

## Decision

- Discover the live tool set from the runtime on every intercepted call.
- Store an operator-approved snapshot hash, classification, and exact JSON schemas in
  PostgreSQL per tenant, provider, and tool.
- Derive classification from the approved record, never from the live provider.
- Deny unknown, missing, changed, invalid, or undiscoverable tools before execution.
- Label values as `OPERATOR`, `TOOL_STRUCTURED`, or `UNTRUSTED_PROSE`.
- Wrap untrusted prose in a fresh per-run nonce and persist the run as `QUARANTINED`.
- Once quarantined, keep reads and reversible cart work available, but require explicit
  human approval for binding or external effects.
- Scope approval to one typed invocation. It does not make the prose trusted or widen
  the run permanently.

## Consequences

- New provider capabilities are visible but inert until reviewed.
- Schema drift fails closed instead of silently changing authority.
- Shopping can continue after merchant prose is read, while high-impact authority
  shrinks.
- The boundary contains no merchant-specific hardcoded tool allow-list. Demo fixtures
  define tools, but the interceptor discovers and reconciles them at runtime.
- Quarantine remains honestly described as a mitigation. Permission narrowing and the
  Phase 2 commit gate are the structural controls.

## Rejected alternatives

- **Prompt-only instructions:** a model can ignore or be manipulated around them.
- **Fixed delimiter:** a merchant who sees the source can write a matching close marker.
- **Trust runtime-declared risk:** the governed provider must not assign its own power.
- **Deny all work after prose:** safe but unusable; reversible shopping should continue.
