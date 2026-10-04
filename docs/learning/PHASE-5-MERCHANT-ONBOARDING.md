# Phase 5: Merchant onboarding

## The simple mental model

An import is a **proposal**, not a database command.

```text
source → map → normalize → preview → human confirms exact fingerprint → merge new SKUs
                                      │
                                      └── changed preview cannot be confirmed
```

This phase gives merchants a practical way to bring products into CONDUIT while keeping
the catalog safe enough for the AI buyer to use.

## What we built

### 1. CSV and XLSX readers

CSV supports quoted commas, quotes, embedded newlines, and CRLF files. XLSX reads the
first worksheet and has row and column limits. Common names such as `Item Code`,
`Product Name`, `Price`, and `Stock` are mapped to CONDUIT fields. Columns beginning
with `attr_` become structured attributes.

The mapping is visible in preview. Missing required mappings stop the import and ask for
correction; the system does not guess silently.

### 2. Exact normalization with row-level reasons

Each row is either `READY` or `SKIPPED`. Prices are parsed from decimal text, so
`199.00` becomes exactly `19900` minor units without floating-point arithmetic.

Stable skip reasons include missing values, invalid SKU, invalid price, currency
mismatch, invalid stock, duplicate SKU in the file, and an already-existing SKU. This
makes a messy file repairable rather than merely “failed.”

### 3. Preview and exact confirmation

Preview records are durable in PostgreSQL, but they do not create products. CONDUIT
hashes the tenant, merchant, source digest, mapping, and normalized rows. Confirmation
must send that exact fingerprint.

If the source or mapping changes, its fingerprint changes. Confirmation locks the import
row in PostgreSQL, so retrying the same confirmation returns a replay result instead of
importing twice.

### 4. Merge-only catalog writes

Confirmation inserts only new SKUs. If a SKU already exists, the row becomes
`EXISTING_SKU` and the current product—including its price—remains untouched. This is
important because an ordinary catalog import must not become a hidden price-change API.

The existing explicit price workflow creates a new version and remains the only way to
change a live price.

### 5. Field-level provenance

For each imported product, CONDUIT records where SKU, name, description, category,
price, stock, and attributes came from. Evidence includes the source type, source name
or URL, SHA-256 source digest, mapped source path, and value observed at import time.

That lets a merchant or auditor answer “why does the system believe this field?” even
after the original source changes.

### 6. Structured storefront extraction

The importer reads schema.org JSON-LD (`Product` and `ProductGroup`), microdata, and
Open Graph product fields. It uses structured SKU/name/price/currency fields. Merchant
prose is carried as visibly untrusted description data; it is not interpreted as an
instruction and does not control import behavior.

If a page only says `InStock` but gives no numeric quantity, CONDUIT stores zero. That
is conservative: it refuses to invent stock that could later be sold.

### 7. SSRF-safe fetching

A storefront URL makes the server contact another server. Without controls, an attacker
could point it at a private database, cloud metadata endpoint, or local admin service.

The fetcher therefore:

1. allows only HTTP and HTTPS on normal web ports;
2. rejects credentials and local hostnames;
3. resolves every address and rejects the request if any address is private/reserved;
4. connects to the exact address it validated, while preserving the original hostname
   for HTTPS;
5. repeats validation after every redirect;
6. limits redirects, time, response bytes, and content type.

The live demo includes a public first hop that redirects to `127.0.0.1`. The second
network connection never occurs.

### 8. Human review for AI enrichment

AI may propose a useful structured attribute with evidence and model identity. The
proposal starts as `PENDING` and changes no product. A human can accept or reject it;
only acceptance writes the attribute.

This uses AI where judgment helps while keeping catalog truth under merchant control.

## What the demo shows

The **Onboarding** workspace has five executable stories:

- messy spreadsheet preview with no catalog mutation;
- an attempted price overwrite that is safely skipped;
- schema.org storefront extraction with provenance;
- a redirect-based SSRF attack blocked before connection; and
- an AI attribute that changes nothing until human acceptance.

Each result shows the source mapping, confirmation fingerprint, row reason, trusted
structured fields, untrusted prose, and provenance evidence where relevant.

## Evidence

- The full pure suite passes 62 tests across 15 files, including CSV normalization,
  exact money, duplicate/reason handling, XLSX, JSON-LD/ProductGroup, Open Graph,
  private IPs, redirect revalidation, and connection pinning.
- The PostgreSQL suite passes 22 tests across five files, including
  preview/confirmation, wrong fingerprints, merge-only prices, provenance, replay
  safety, and enrichment review.
- The production dependency audit reports no known vulnerabilities. ExcelJS's old
  transitive `uuid` range is narrowly overridden to patched `11.1.1`; XLSX parsing is
  retested under that resolution.
- A real public Allbirds product page was securely fetched and imported into a fresh
  local USD tenant on 2026-10-04. See
  [the validation record](../research/PHASE-5-PUBLIC-STOREFRONT-VALIDATION.md).

## Honest limits

- The demo storefront scenario uses a local fixture so it remains reliable and does not
  depend on a retailer's availability; the separate dated acceptance uses the public
  page.
- V1 imports the first XLSX worksheet and caps it at 10,000 rows and 200 columns.
- ExcelJS still carries deprecated legacy transitive packages even though the current
  vulnerability audit is clean; reassess or replace it when its next maintained release
  is available.
- The HTML extractors intentionally support common standard shapes, not every malformed
  ecommerce theme.
- Numeric inventory must be supplied explicitly; availability words are not converted
  into made-up quantities.
- AI enrichment is a review mechanism, not an autonomous catalog generator.
- Production should add outbound firewall rules and malware/file scanning as defense in
  depth.

## How this moves us toward the goal

Before Phase 5, the safe AI buyer depended on hand-created structured products. Now a
merchant can bring real catalog data into that same trusted path without giving files,
web pages, or models authority to overwrite money. Phase 6 can now evaluate the whole
chain—from hostile source data through AI selection to the deterministic purchase
boundary.
