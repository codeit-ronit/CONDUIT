# Phase 7, slice 1: Product surface and UCP boundary

## What did we build?

We added the first external commerce-protocol adapter and made it visible in the Trust
Lab. A buyer platform can discover that this local business supports one operation:
catalog search. A successful demonstration authenticates the platform, verifies that the
key belongs to the declared agent profile, negotiates an exact shared protocol version,
scopes the read to one tenant and merchant, and converts real PostgreSQL products to the
UCP catalog shape.

Two negative paths are equally important: the same key with an impostor profile is
blocked, and an older protocol profile is rejected. Both stop before the catalog is
read.

## Why start with catalog search rather than checkout?

Checkout mixes cart lifecycle, user finalization, payment handlers, recovery, and
possibly cryptographic mandates. Advertising it before all of those pieces exist would
be misleading. Catalog search is a thin end-to-end path that proves the architectural
seam first.

## How does the request move?

```text
public discovery profile
        ↓
API key authentication + UCP-Agent identity binding
        ↓
exact protocol and catalog-capability negotiation
        ↓
credential-derived tenant + merchant scope
        ↓
real PostgreSQL catalog
        ↓
UCP product / variant / integer-price response
```

The important order is that data access is last. A caller cannot read a catalog and then
be rejected afterward.

## What do the labels mean?

- **REAL LOCAL:** code and PostgreSQL behavior executed on this machine.
- **MODELLED:** the demo platform registration and API key are local stand-ins.
- **REFERENCED:** shapes and rules come from the dated UCP specification.
- **NOT_CLAIMED:** the official UCP conformance suite and production hosting gate have
  not passed.

This is more useful than one broad “working” label because each part has different
evidence.

## Security choices

The raw API key is never returned to the browser. Only its SHA-256 digest is retained by
the demo credential object, comparison is constant-time, and scope comes from that
credential. A minimum key length blocks obvious low-entropy examples. Production still
needs a secret manager, rotation, revocation storage, rate limits, TLS, and preferably
HTTP Message Signatures for permissionless platform onboarding.

## Evidence and limits

Pure tests cover narrow discovery, identity mismatch, exact version matching, scoped
reads, and authoritative money mapping. The live UI executes the success path against
PostgreSQL and displays zero reads on pre-data failures.

This is slice 1, not the completion of Phase 7. Buyer/merchant consoles, authenticated
MCP, UCP checkout, receipts, production auth, official schema validation, and a hosted
conformance report remain.

## Next slice

Build the buyer journey console around the existing bounded agent and trusted commit,
then expose the same carefully scoped catalog search through authenticated MCP. After
that, implement UCP cart/checkout only when the exact current schemas and finalization
rules have executable tests.
