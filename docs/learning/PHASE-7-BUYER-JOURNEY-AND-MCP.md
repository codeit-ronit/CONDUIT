# Phase 7, slice 2: Buyer journey and authenticated MCP

## What did we build?

We connected pieces that already existed into two understandable product paths.

The **Buyer journey** runs the real bounded-agent scenario and presents its evidence as
five stages:

1. the buyer confirms exact typed constraints;
2. code filters invalid products and the scripted model chooses among valid ones;
3. the trusted PostgreSQL commit gate reprices and checks authorization;
4. a deterministic local provider models payment authorization;
5. a receipt links the operation, order, provider reference, and audit-chain head.

The **Authenticated MCP** demo creates an official MCP client, discovers
`search_catalog`, sends a UCP-shaped tool request, and reads one credential-scoped
merchant catalog from PostgreSQL.

## Why is this not a new purchase implementation?

A demo that bypasses production code can look good while proving nothing. The journey
calls the same `runAgentScenario(..., "scripted")` path used by the safety tests. The
new code only organizes its result for a human reader. Pricing, authorization,
inventory, idempotency, provider work, and audit remain in their existing owners.

## How does MCP fit?

```text
official MCP client
      ↓ bearer checked before protocol dispatch
credential → tenant + merchant + allowed UCP-Agent
      ↓ MCP initialize / tools/list / tools/call
search_catalog + meta["ucp-agent"].profile
      ↓ identity binding + exact UCP capability negotiation
PostgreSQL catalog → UCP structured result
```

MCP carries the call. It does not decide who the caller is or what merchant it may read.
A bad bearer receives HTTP 401. A correct bearer claiming another agent profile gets an
MCP tool error, and catalog read count stays zero.

## What is real and what is modelled?

- **REAL LOCAL DATABASE:** catalog reads, server pricing, trusted commit, order,
  operation evidence, and audit chain executed locally against PostgreSQL.
- **SCRIPTED:** typed intent and product choice use the deterministic agent strategy so
  the visual demo is repeatable.
- **MODELLED:** the order-provider adapter returns deterministic local responses. It is
  not Razorpay and no bank or card network is called.
- **REFERENCED / PARTIAL:** UCP and MCP request shapes follow dated primary sources, but
  public deployment and official conformance are not claimed.

## Security details in simple words

The demo generates a long random bearer secret at server start. Only its digest is held
in the UCP credential, it is compared in constant time, and it never appears in the
browser response. The credential—not caller arguments—chooses the tenant and merchant.
The Node adapter also applies localhost Host and Origin guards.

Production still needs HTTPS, durable credential lifecycle or OAuth-based MCP resource
server authentication, rate limiting, safe remote-profile retrieval and caching, and a
secret manager.

## Evidence

- Pure MCP tests use the official client and server packages.
- A malformed bearer is stopped before MCP dispatch.
- Agent-profile impersonation is stopped before a catalog read.
- A PostgreSQL integration test executes client discovery and `search_catalog`.
- Another PostgreSQL test verifies the five journey stages, ₹398.00 authoritative total,
  durable operation/order/provider IDs, audit head, and zero external money.

## What remains?

The current MCP surface is catalog-only. UCP cart, checkout, finalization, order, and
payment-handler bindings remain unadvertised. The next product slice should add a
merchant-facing catalog/provenance console and stronger browser session identity before
checkout interoperability. Real-model evaluation and a real payment sandbox remain
separate credential-dependent tracks.
