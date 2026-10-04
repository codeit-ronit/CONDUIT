import {
  CommerceService,
  DeterministicModelledOrderProvider,
} from "@conduit/application";
import {
  PostgresCommerceRepository,
  PostgresMerchantCatalogRepository,
  PostgresMerchantIdentityRepository,
  PostgresOnboardingRepository,
} from "@conduit/infrastructure";
import type { Pool } from "@conduit/infrastructure";
import { MerchantConsoleService } from "@conduit/merchant-console";
import { OnboardingService } from "@conduit/onboarding";

export const demoMerchantEmail = "merchant@conduit.local";
export const defaultDemoMerchantPassword = "conduit-demo-merchant";

interface ScopeRow {
  readonly tenant_id: string;
  readonly merchant_id: string;
}

export async function createMerchantDemoSurface(pool: Pool) {
  const commerce = new CommerceService(
    new PostgresCommerceRepository(pool),
    new DeterministicModelledOrderProvider(),
  );
  const onboarding = new OnboardingService(new PostgresOnboardingRepository(pool));
  let scope = (
    await pool.query<ScopeRow>(
      `SELECT t.id AS tenant_id, m.id AS merchant_id
       FROM conduit.tenants t
       JOIN conduit.merchants m ON m.tenant_id = t.id
       WHERE t.slug = 'merchant-console-demo' AND m.slug = 'catalog'`,
    )
  ).rows[0];
  if (!scope) {
    const tenant = await commerce.createTenant({
      slug: "merchant-console-demo",
      displayName: "CONDUIT Merchant Demo",
    });
    const merchant = await commerce.createMerchant({
      tenantId: tenant.id,
      slug: "catalog",
      displayName: "North Star Foods",
      currency: "INR",
    });
    scope = { tenant_id: tenant.id, merchant_id: merchant.id };
  }
  const existingSkus = new Set(
    (await commerce.listProducts(scope.tenant_id, scope.merchant_id)).map(
      (product) => product.sku,
    ),
  );
  if (!existingSkus.has("PANEER-01") || !existingSkus.has("TEA-01")) {
    const preview = await onboarding.previewCsv({
      tenantId: scope.tenant_id,
      merchantId: scope.merchant_id,
      currency: "INR",
      sourceName: "north-star-launch-catalog.csv",
      sourceContent: [
        "sku,name,description,price,stock,category,attr_vegetarian,attr_origin",
        "PANEER-01,Paneer Tikka,Smoky paneer dinner,199.00,25,dinner,true,Delhi",
        "TEA-01,Assam Breakfast Tea,Strong black tea,249.00,12,tea,true,Assam",
      ].join("\n"),
    });
    await onboarding.confirmImport(
      scope.tenant_id,
      preview.id,
      preview.confirmationFingerprint,
    );
  }

  const service = new MerchantConsoleService(
    new PostgresMerchantIdentityRepository(pool),
    new PostgresMerchantCatalogRepository(pool),
  );
  const demoPassword =
    process.env.DEMO_MERCHANT_PASSWORD ?? defaultDemoMerchantPassword;
  if (process.env.NODE_ENV === "production" && !process.env.DEMO_MERCHANT_PASSWORD) {
    throw new Error("DEMO_MERCHANT_PASSWORD is required in production");
  }
  await service.provisionLocalUser({
    email: demoMerchantEmail,
    displayName: "North Star Operator",
    password: demoPassword,
    tenantId: scope.tenant_id,
    merchantId: scope.merchant_id,
    role: "OWNER",
  });

  return {
    login: (email: string, password: string) => service.login(email, password),
    logout: (token: string | undefined) => service.logout(token),
    session: (token: string | undefined) => service.authenticate(token),
    async catalog(token: string | undefined) {
      const snapshot = await service.catalogFor(token);
      return {
        phase: 7,
        surface: "MERCHANT_CONSOLE",
        title: "Merchant catalog with evidence for every imported field",
        lesson:
          "The session chooses one merchant scope; the console then joins authoritative catalog state to durable source provenance.",
        claimLevel: "REAL_LOCAL_DATABASE",
        identity: {
          displayName: snapshot.principal.displayName,
          email: snapshot.principal.email,
          merchantName: snapshot.principal.merchantName,
          role: snapshot.principal.role,
          sessionExpiresAt: snapshot.principal.expiresAt,
          scopeFromSession: true,
        },
        catalog: snapshot.catalog,
        authentication: {
          passwordStorage: "SCRYPT_SALTED_DIGEST",
          sessionStorage: "SHA256_TOKEN_DIGEST_IN_POSTGRESQL",
          browserCookie: "HTTP_ONLY_SAME_SITE_STRICT",
          rawSessionTokenReturnedInJson: false,
          productionReady: false,
        },
      };
    },
  };
}
