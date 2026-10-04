import {
  CommerceService,
  DeterministicModelledOrderProvider,
} from "@conduit/application";
import {
  MerchantAuthenticationError,
  MerchantConsoleService,
} from "@conduit/merchant-console";
import { OnboardingService } from "@conduit/onboarding";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresCommerceRepository } from "../src/postgres-commerce-repository.js";
import {
  PostgresMerchantCatalogRepository,
  PostgresMerchantIdentityRepository,
} from "../src/postgres-merchant-console-repository.js";
import { PostgresOnboardingRepository } from "../src/postgres-onboarding-repository.js";
import { createDatabasePool } from "../src/postgres.js";

describe("Phase 7 durable merchant console", () => {
  let pool: Pool;
  let commerce: CommerceService;
  let onboarding: OnboardingService;
  let consoleService: MerchantConsoleService;

  beforeAll(() => {
    pool = createDatabasePool();
    commerce = new CommerceService(
      new PostgresCommerceRepository(pool),
      new DeterministicModelledOrderProvider(),
    );
    onboarding = new OnboardingService(new PostgresOnboardingRepository(pool));
    consoleService = new MerchantConsoleService(
      new PostgresMerchantIdentityRepository(pool),
      new PostgresMerchantCatalogRepository(pool),
    );
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE TABLE conduit.tenants RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("derives merchant scope from a revocable hashed PostgreSQL session", async () => {
    const tenant = await commerce.createTenant({
      slug: `console-${crypto.randomUUID().slice(0, 8)}`,
      displayName: "Console Test",
    });
    const merchant = await commerce.createMerchant({
      tenantId: tenant.id,
      slug: "allowed",
      displayName: "Allowed Merchant",
      currency: "INR",
    });
    const otherMerchant = await commerce.createMerchant({
      tenantId: tenant.id,
      slug: "other",
      displayName: "Other Merchant",
      currency: "INR",
    });
    const preview = await onboarding.previewCsv({
      tenantId: tenant.id,
      merchantId: merchant.id,
      currency: "INR",
      sourceName: "merchant-a.csv",
      sourceContent: "sku,name,price,stock,category\nA-1,Allowed Product,19.00,4,tea",
    });
    await onboarding.confirmImport(
      tenant.id,
      preview.id,
      preview.confirmationFingerprint,
    );
    await commerce.createProduct({
      tenantId: tenant.id,
      merchantId: otherMerchant.id,
      sku: "SECRET-1",
      displayName: "Other Merchant Secret",
      description: "Must never cross the membership boundary",
      category: "private",
      attributes: {},
      price: { currency: "INR", minorUnits: "9900" },
      stock: 1,
    });
    await consoleService.provisionLocalUser({
      email: "owner@example.com",
      displayName: "Owner",
      password: "durable merchant password",
      tenantId: tenant.id,
      merchantId: merchant.id,
      role: "OWNER",
    });

    await expect(
      consoleService.login("owner@example.com", "wrong merchant password"),
    ).rejects.toBeInstanceOf(MerchantAuthenticationError);
    const login = await consoleService.login(
      "owner@example.com",
      "durable merchant password",
    );
    const stored = await pool.query<{
      readonly token_digest: string;
      readonly password_digest: string;
    }>(
      `SELECT bs.token_digest, mu.password_digest
       FROM conduit.browser_sessions bs
       JOIN conduit.merchant_users mu ON mu.id = bs.user_id
       WHERE bs.id = $1`,
      [login.principal.sessionId],
    );
    expect(stored.rows[0]?.token_digest).not.toBe(login.token);
    expect(stored.rows[0]?.password_digest).not.toContain("durable merchant password");

    const response = await consoleService.catalogFor(login.token);
    expect(response.principal).toMatchObject({
      tenantId: tenant.id,
      merchantId: merchant.id,
      role: "OWNER",
    });
    expect(response.catalog).toMatchObject({
      merchant: { displayName: "Allowed Merchant" },
      summary: {
        productCount: 1,
        fieldsWithProvenance: 7,
        confirmedImports: 1,
      },
      products: [
        {
          sku: "A-1",
          displayName: "Allowed Product",
        },
      ],
    });
    expect(response.catalog.products[0]?.provenance).toHaveLength(7);
    expect(
      response.catalog.products[0]?.provenance.every(
        (source) => source.sourceRef === "merchant-a.csv",
      ),
    ).toBe(true);
    expect(JSON.stringify(response.catalog)).not.toContain("Other Merchant Secret");

    await consoleService.provisionLocalUser({
      email: "owner@example.com",
      displayName: "Owner",
      password: "durable merchant password",
      tenantId: tenant.id,
      merchantId: merchant.id,
      role: "OWNER",
    });
    await expect(consoleService.catalogFor(login.token)).resolves.toBeDefined();

    await consoleService.provisionLocalUser({
      email: "owner@example.com",
      displayName: "Owner",
      password: "changed durable password",
      tenantId: tenant.id,
      merchantId: merchant.id,
      role: "OWNER",
    });
    await expect(consoleService.catalogFor(login.token)).rejects.toBeInstanceOf(
      MerchantAuthenticationError,
    );
    const replacement = await consoleService.login(
      "owner@example.com",
      "changed durable password",
    );
    await consoleService.logout(replacement.token);
    await expect(consoleService.catalogFor(replacement.token)).rejects.toBeInstanceOf(
      MerchantAuthenticationError,
    );
  });
});
