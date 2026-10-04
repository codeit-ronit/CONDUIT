# Phase 5 public storefront validation

**Checked:** 2026-10-04

## Purpose

The reliable browser demo uses a fixed storefront fixture. This separate acceptance
record proves that the same production code can fetch and import a real public page.

## Source

- URL: <https://www.allbirds.com/products/mens-tree-runners>
- Fetch path: `SafeStorefrontFetcher`
- Structured format found: schema.org JSON-LD `ProductGroup`
- Final URL: unchanged; zero redirects
- HTML size observed: 839,096 bytes, below the 2 MB limit

## Structured facts observed

```text
sku: MENS_TREE_RUNNERS
name: Men's Tree Runner
price: USD 100.00
brand: Allbirds
numeric stock quantity: not supplied
```

The page also exposes `availability: InStock`. CONDUIT did not turn this qualitative
word into an invented quantity; the imported stock was zero.

## End-to-end result

The importer created a fresh local tenant and USD merchant, saved a durable `PREVIEWED`
batch, and marked its one normalized row `READY`. Confirmation with the exact preview
fingerprint returned:

```json
{
  "status": "CONFIRMED",
  "imported": 1,
  "skipped": 0
}
```

The catalog product stored `USD 10000` integer minor units, SKU `MENS_TREE_RUNNERS`,
brand `Allbirds`, and stock `0`.

## Finding that improved the implementation

The original fixture used schema.org `Product`, while this live page uses `ProductGroup`
for the product family and lightweight `hasVariant` links. The parser was extended to
accept the standard group as one catalog product, and a regression test was added. No
prose inference or special retailer-specific selector was added.

## Claim boundary

This proves a dated live fetch and local PostgreSQL import. It does not claim that the
retailer's markup will remain unchanged, that CONDUIT integrates with its checkout, or
that any real payment was made.
