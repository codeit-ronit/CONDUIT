# UCP 2026-08-25 boundary note

**Checked:** 2026-10-04  
**Evidence type:** primary specification and official repositories  
**Implementation claim:** partial referenced adapter; conformance not claimed

## What changed since the older project knowledge

The latest tagged UCP release is `v2026-08-25`. It adds independent capability
versioning, multi-vertical structure, request constraints/actions, payment security
work, and identity/consent changes. Therefore the old project architecture is a source
of ideas, not a protocol contract.

## Rules used in this slice

1. A business profile is discovered at `/.well-known/ucp`.
2. The profile carries a dated protocol version, services, capabilities, and payment
   handlers.
3. Catalog search is named `dev.ucp.shopping.catalog.search` and the REST operation is
   `POST /catalog/search`.
4. Exact capability versions are intersected; date ordering does not imply
   compatibility.
5. API keys are an allowed pre-established authentication mechanism, but the
   authenticated principal must be authorized for the profile named by `UCP-Agent`.
6. Catalog price uses integer minor units plus ISO currency; checkout remains the later
   authoritative transaction surface.
7. Public profiles and REST endpoints require HTTPS. The current localhost demo is not a
   conformant public deployment.

## Implemented now

- version-pinned business profile;
- one advertised catalog-search capability;
- exact protocol/capability negotiation;
- constant-time comparison of stored API-key digests;
- API-key principal to `UCP-Agent` identity binding;
- credential-derived tenant and merchant scope;
- canonical catalog-to-UCP product/variant/price projection;
- live success and fail-closed demonstrations.

## Deliberately not claimed

- official schema-validation or conformance-suite pass;
- production HTTPS/TLS deployment;
- dynamic remote platform-profile retrieval and safe caching;
- HTTP Message Signatures, OAuth, or mTLS;
- pagination, all catalog filters, lookup, cart, checkout, order, payment handlers,
  webhooks, AP2 mandates, or MCP transport.

## Primary sources

- [UCP v2026-08-25 release](https://github.com/Universal-Commerce-Protocol/ucp/releases/tag/v2026-08-25)
- [UCP overview and discovery](https://ucp.dev/2026-08-25/specification/overview/)
- [Catalog search capability](https://ucp.dev/2026-08-25/specification/shopping/catalog/search/)
- [Catalog REST binding](https://ucp.dev/2026-08-25/specification/shopping/catalog/rest/)
- [UCP schema validator](https://github.com/Universal-Commerce-Protocol/ucp-schema)
