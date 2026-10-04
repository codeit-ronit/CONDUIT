# ADR-0012: Authenticated MCP transport and evidence-led buyer journey

**Status:** Accepted  
**Date:** 2026-10-04

## Context

The bounded buyer, trusted commit gate, provider seam, receipt, and audit chain already
worked, but a new user had to visit separate technical scenarios to understand one
purchase. UCP catalog search also existed only as an application-level adapter, not as
the MCP tool transport named in the product strategy.

MCP is a transport and discovery protocol. It must not become a second place for
commerce authorization, tenant selection, pricing, or payment rules.

## Decision

- Add one buyer-journey view that reuses the existing scripted bounded-agent scenario;
  do not build a presentation-only purchase path.
- Show authorization, selection, commit, payment, and receipt as five linked stages.
- Give every stage its own evidence label. The local database commit and receipt are
  real; model selection is scripted; provider processing is modelled and moves no real
  money.
- Use the official MCP TypeScript SDK for modern Streamable HTTP rather than maintaining
  a hand-written JSON-RPC transport.
- Pin the MCP client to the `2026-07-28` modern era and pin SDK package versions.
- Authenticate the bearer credential before MCP dispatch, then derive tenant, merchant,
  and permitted agent profile from that credential.
- Require `meta["ucp-agent"].profile` on `search_catalog` and bind it to the
  authenticated identity before any catalog read.
- Advertise both REST and MCP catalog transports, but still advertise only the one UCP
  catalog-search capability that is implemented.
- Keep the generated demo secret on the server. The browser receives evidence that a
  bearer was used, never the bearer itself.
- Keep the conformance claim at `PARTIAL_NOT_CLAIMED` until public HTTPS, production
  authentication, official UCP validation, and the remaining binding details pass.

## Consequences

One click now demonstrates the product thesis from typed intent to durable receipt, and
another executes an official MCP client against the same credential-scoped PostgreSQL
catalog. Transport code stays at the protocol edge; core commerce rules are unchanged.

The local API-key flow is useful executable evidence, not production identity. The
official high-level MCP SDK also represents a tool callback error as an `isError` tool
result. Therefore an agent-profile mismatch inside `search_catalog` is visibly denied
with zero data reads, but we do not claim exact UCP MCP error-envelope conformance.
