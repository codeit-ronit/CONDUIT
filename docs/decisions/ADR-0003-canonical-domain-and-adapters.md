# ADR-0003: Canonical domain with versioned protocol adapters

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

MCP, UCP, ACP, AP2, x402, and payment-provider APIs solve different layers and
change at different speeds. The old knowledge document already contains an AP2
model that differs from the current AP2 v0.2 specification.

## Decision

CONDUIT owns a small canonical model for catalog, cart, authorization, checkout,
payment operation, and receipt. Each external protocol/provider has a versioned
adapter and conformance tests. Protocol objects do not leak into domain logic.

## Consequences

- We can support multiple ecosystems without making the core a lowest-common-
  denominator abstraction.
- Translation code and version matrices add work, but drift is explicit.
- “Compatible” or “conformant” is claimed per adapter and version, never for the
  product in general.
