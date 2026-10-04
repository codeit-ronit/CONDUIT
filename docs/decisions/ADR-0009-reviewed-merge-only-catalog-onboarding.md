# ADR-0009: Catalog onboarding is reviewed, merge-only, and provenance-first

**Status:** accepted

**Date:** 2026-10-04

## Context

Merchant catalog input is both useful and unsafe. Spreadsheets contain inconsistent
headers and malformed rows. Storefront pages contain untrusted prose, may redirect to
private services, and use several structured-data shapes. A model can help propose
attributes, but it must not silently turn a guess into catalog truth or replace a
merchant's current price.

## Decision

- Split every import into a durable **preview** and an explicit **confirmation**.
- Bind confirmation to the tenant, merchant, source digest, proposed mapping, and every
  normalized row with a SHA-256 fingerprint.
- Infer common CSV/XLSX headings deterministically and permit an explicit mapping
  override. Parse prices as exact decimal text into integer minor units.
- Give every rejected row a closed reason code and readable explanation.
- Make ordinary imports merge-only. A SKU that already exists is skipped, including its
  price, inventory, description, and attributes. Price changes continue through the
  explicit versioned-price workflow.
- Store field-level provenance for imported products: source kind, source reference,
  content digest, source path, and observed value.
- Extract storefront facts only from JSON-LD, microdata, or Open Graph. Never ask a
  model to infer a price or SKU from page prose.
- Fetch storefronts through an SSRF-resistant adapter: HTTP(S) only, public IPs only,
  DNS validation on every redirect, connection pinning to the validated address,
  redirect/time/body limits, and HTML-only responses.
- Store model-proposed attributes as pending review records. Only a human accept action
  may copy the value into product attributes.

## Consequences

- A preview is inspectable and causes no product write.
- Replaying a confirmed import is idempotent, and racing with an existing SKU cannot
  overwrite catalog state.
- The source of every accepted field remains explainable after the original file or page
  changes.
- Storefront availability text does not become invented quantity. When no numeric stock
  exists, V1 records zero and requires the merchant to set inventory explicitly.
- Mapping inference is intentionally conservative. Unrecognized required headings must
  be corrected by a human mapping instead of guessed by a model.
- SSRF defenses reduce network risk, but production deployment should also enforce
  outbound network policy as a second layer.

## Rejected alternatives

- **Upsert the whole catalog:** convenient, but a bad file could silently rewrite live
  prices and inventory.
- **Let a model parse storefront prose:** it is nondeterministic and turns adversarial
  content into business facts.
- **Validate only the first URL:** redirects can point a public URL at an internal
  address.
- **Trust DNS and connect by hostname afterward:** a DNS-rebinding change could replace
  the validated address before connection.
- **Apply AI enrichment immediately:** a plausible suggestion is not verified merchant
  data.
