import {
  CommerceService,
  DeterministicModelledOrderProvider,
} from "@conduit/application";
import { OnboardingService } from "@conduit/onboarding";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresCommerceRepository } from "../src/postgres-commerce-repository.js";
import { PostgresOnboardingRepository } from "../src/postgres-onboarding-repository.js";
import { createDatabasePool } from "../src/postgres.js";

describe("Phase 5 durable catalog onboarding", () => {
  let pool: Pool;
  let commerce: CommerceService;
  let onboarding: OnboardingService;

  beforeAll(() => {
    pool = createDatabasePool();
    commerce = new CommerceService(
      new PostgresCommerceRepository(pool),
      new DeterministicModelledOrderProvider(),
    );
    onboarding = new OnboardingService(new PostgresOnboardingRepository(pool));
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE TABLE conduit.tenants RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("imports ready rows, preserves existing prices, records reasons and provenance", async () => {
    const { tenant, merchant } = await world(commerce);
    const existing = await commerce.createProduct({
      tenantId: tenant.id,
      merchantId: merchant.id,
      sku: "EXISTING-1",
      displayName: "Existing Product",
      description: "Original",
      category: "dinner",
      attributes: {},
      price: { currency: "INR", minorUnits: "99900" },
      stock: 10,
    });
    const csv = [
      "SKU,Product Name,Price,Stock,Category,attr_vegetarian",
      "NEW-1,New Product,199.00,5,dinner,true",
      "EXISTING-1,Overwrite Attempt,1.00,50,dinner,true",
      "BAD PRICE,Bad,not-money,2,dinner,true",
    ].join("\n");
    const preview = await onboarding.previewCsv({
      tenantId: tenant.id,
      merchantId: merchant.id,
      currency: "INR",
      sourceName: "messy-products.csv",
      sourceContent: csv,
    });
    expect(preview.status).toBe("PREVIEWED");
    expect(preview.rows.map((row) => row.reasonCode)).toEqual([
      null,
      null,
      "INVALID_SKU",
    ]);

    const confirmed = await onboarding.confirmImport(
      tenant.id,
      preview.id,
      preview.confirmationFingerprint,
    );
    expect(confirmed).toMatchObject({
      status: "CONFIRMED",
      imported: 1,
      skipped: 2,
    });
    expect(confirmed.rows.map((row) => row.reasonCode)).toEqual([
      null,
      "EXISTING_SKU",
      "INVALID_SKU",
    ]);
    const products = await commerce.listProducts(tenant.id, merchant.id);
    expect(products).toHaveLength(2);
    const oldPrice = await commerce.getPriceHistory(tenant.id, existing.id);
    expect(oldPrice).toHaveLength(1);
    expect(oldPrice[0]?.price.minorUnits).toBe(99900n);

    const provenance = await pool.query<{ readonly count: string }>(
      `SELECT count(*)::text AS count
       FROM conduit.product_provenance pp
       JOIN conduit.products p ON p.id = pp.product_id
       WHERE p.sku = 'NEW-1'`,
    );
    expect(provenance.rows[0]?.count).toBe("7");

    const replay = await onboarding.confirmImport(
      tenant.id,
      preview.id,
      preview.confirmationFingerprint,
    );
    expect(replay.status).toBe("REPLAYED");
    expect(await commerce.listProducts(tenant.id, merchant.id)).toHaveLength(2);
  });

  it("rejects a changed confirmation fingerprint before inserting products", async () => {
    const { tenant, merchant } = await world(commerce);
    const preview = await onboarding.previewCsv({
      tenantId: tenant.id,
      merchantId: merchant.id,
      currency: "INR",
      sourceName: "one.csv",
      sourceContent: "sku,name,price\nONE-1,One,10.00",
    });
    await expect(
      onboarding.confirmImport(tenant.id, preview.id, "0".repeat(64)),
    ).rejects.toThrow("fingerprint");
    expect(await commerce.listProducts(tenant.id, merchant.id)).toHaveLength(0);
  });

  it("keeps model-enriched attributes pending until a human accepts them", async () => {
    const { tenant, merchant } = await world(commerce);
    const product = await commerce.createProduct({
      tenantId: tenant.id,
      merchantId: merchant.id,
      sku: "ENRICH-1",
      displayName: "Enrichment Product",
      description: "Contains paneer",
      category: "dinner",
      attributes: {},
      price: { currency: "INR", minorUnits: "10000" },
      stock: 2,
    });
    const proposal = await onboarding.proposeAttribute({
      tenantId: tenant.id,
      productId: product.id,
      attributeName: "vegetarian",
      proposedValue: true,
      evidence: "Merchant description says paneer; human verification required.",
      modelId: "modelled-enricher-v1",
    });
    expect(proposal.status).toBe("PENDING");
    expect(
      (await commerce.listProducts(tenant.id, merchant.id))[0]?.attributes,
    ).toEqual({});
    const reviewed = await onboarding.reviewAttribute(tenant.id, proposal.id, "ACCEPT");
    expect(reviewed.status).toBe("ACCEPTED");
    expect(
      (await commerce.listProducts(tenant.id, merchant.id))[0]?.attributes,
    ).toEqual({ vegetarian: true });
  });
});

async function world(commerce: CommerceService) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const tenant = await commerce.createTenant({
    slug: `onboard-${suffix}`,
    displayName: "Onboarding Test",
  });
  const merchant = await commerce.createMerchant({
    tenantId: tenant.id,
    slug: "merchant",
    displayName: "Test Merchant",
    currency: "INR",
  });
  return { tenant, merchant };
}
