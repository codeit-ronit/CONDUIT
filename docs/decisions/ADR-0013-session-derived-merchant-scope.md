# ADR-0013: Derive merchant-console scope from a durable session

**Status:** Accepted  
**Date:** 2026-10-04

## Context

Phase 5 stored field-level catalog provenance, but merchants could see it only through
technical onboarding scenarios. A product console needs browser identity before it can
safely expose tenant-owned data. Accepting `tenantId` or `merchantId` from the browser
would turn a presentation concern into an authorization vulnerability.

## Decision

- Add a separate `@conduit/merchant-console` module for authentication and the scoped
  read model; do not put browser-session rules in catalog or protocol adapters.
- Store merchant users, one V1 merchant membership per user, and revocable sessions in
  PostgreSQL.
- Hash passwords with Node's scrypt and a random per-user salt. Never store plaintext.
- Generate 256-bit random session tokens. Return the raw token only as an `HttpOnly`,
  `SameSite=Strict` cookie; store only its SHA-256 digest in PostgreSQL.
- Resolve tenant and merchant from the active session plus membership join. The catalog
  endpoint accepts no scope identifiers.
- Revoke sessions on logout, expiry, or an actual password change. Reprovisioning the
  same local credential preserves existing sessions across server restarts.
- Join catalog state to durable `product_provenance` records at read time rather than
  copying evidence into a presentation table.
- Publish the default demo credential only in non-production mode when no custom demo
  password is configured.
- Treat the local account as MODELLED identity. It is not a production identity-provider
  claim.

## Consequences

The merchant sees authoritative price, stock, source path, source digest, and observed
value in one console. A browser cannot request another merchant by changing an ID. A
stolen database alone does not reveal reusable raw session tokens or plaintext
passwords.

The V1 identity system deliberately lacks account recovery, MFA, login throttling,
enterprise SSO, device/session management, and security-event notification. Public
deployment must add those controls, HTTPS so cookies are `Secure`, proxy-aware origin
validation, centralized secrets, and an external identity provider or a fully reviewed
identity service.
