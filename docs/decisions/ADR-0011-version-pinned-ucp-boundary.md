# ADR-0011: Version-pinned UCP boundary with narrow claims

**Status:** Accepted  
**Date:** 2026-10-04

## Context

Phase 7 needs an interoperable product surface, but UCP is an evolving external
standard. The old project notes predate the current `2026-08-25` release. Copying an
older checkout implementation into the domain would couple CONDUIT to stale protocol
shapes and could create a false conformance claim.

The first useful public operation is catalog search. It exercises discovery,
authentication, capability negotiation, tenant/merchant scoping, authoritative money,
and visible product data without pretending that checkout or payment interoperation is
already complete.

## Decision

- Keep UCP in `@conduit/protocol-adapters`; the canonical domain remains protocol
  neutral.
- Pin each advertised service and capability to UCP `2026-08-25`.
- Advertise only `dev.ucp.shopping.catalog.search` in the first slice.
- Require exact protocol and capability version intersection. Never infer compatibility
  because one date is newer.
- For the local slice, use a high-entropy API key stored as a digest and bind its
  principal to the exact `UCP-Agent` profile URL.
- Derive tenant and merchant scope from the authenticated credential, never request
  input.
- Run authentication and negotiation before catalog access.
- Publish `/.well-known/ucp` for local inspection, while explicitly recording
  `NOT_CLAIMED` for conformance. Local HTTP is a development surface and does not meet
  UCP's public HTTPS hosting requirement.
- Do not advertise checkout, order, payment handlers, AP2, or MCP until each has an
  implemented operation and its own validation evidence.

## Consequences

The adapter is smaller and honest: external consumers can see one implemented capability
and no fictional ones. A leaked key cannot be relabelled as another platform identity,
and it cannot select another merchant scope. Upgrading UCP requires changing and
retesting the adapter rather than rewriting commerce rules.

This is not production authentication. Production should prefer permissionless HTTP
Message Signatures or a managed OAuth/mTLS relationship where appropriate, rotate
credentials through a secret manager, use TLS, rate limits, and the official UCP schema
and conformance tools.
