import {
  CommerceService,
  DeterministicModelledOrderProvider,
} from "@conduit/application";
import {
  PostgresCommerceRepository,
  PostgresOnboardingRepository,
  SafeStorefrontFetcher,
} from "@conduit/infrastructure";
import type { Pool, QueryResultRow } from "@conduit/infrastructure";
import { OnboardingService } from "@conduit/onboarding";
import type { StorefrontFetcher } from "@conduit/onboarding";

export const onboardingScenarioNames = [
  "spreadsheet-preview",
  "merge-only",
  "structured-storefront",
  "ssrf-redirect",
  "enrichment-review",
] as const;
export type OnboardingScenarioName = (typeof onboardingScenarioNames)[number];

export async function runOnboardingScenario(pool: Pool, name: OnboardingScenarioName) {
  const commerce = new CommerceService(
    new PostgresCommerceRepository(pool),
    new DeterministicModelledOrderProvider(),
  );
  const repository = new PostgresOnboardingRepository(pool);
  const world = await createWorld(commerce);

  if (name === "ssrf-redirect") {
    let transportCalls = 0;
    const fetcher = new SafeStorefrontFetcher({
      resolve: (hostname) =>
        Promise.resolve([
          {
            address: hostname === "public.example" ? "93.184.216.34" : "127.0.0.1",
            family: 4 as const,
          },
        ]),
      transport: {
        get: () => {
          transportCalls += 1;
          return Promise.resolve({
            status: 302,
            location: "http://internal.example/admin",
            contentType: "text/html",
            body: "",
          });
        },
      },
    });
    let refusal = "";
    try {
      await fetcher.fetch("https://public.example/product");
    } catch (error: unknown) {
      refusal = error instanceof Error ? error.message : "Blocked";
    }
    return response(name, {
      claimLevel: "MODELLED",
      security: {
        outcome: "BLOCKED",
        refusal,
        transportCalls,
        lesson:
          "The public first hop was allowed. DNS was resolved again for the redirect, and the private second hop was blocked before connecting.",
      },
    });
  }

  if (name === "structured-storefront") {
    const fetcher: StorefrontFetcher = {
      fetch: () =>
        Promise.resolve({
          finalUrl: "https://fixture.shop/products/paneer",
          redirects: [],
          contentType: "text/html",
          html: `<script type="application/ld+json">{
            "@context":"https://schema.org","@type":"Product",
            "sku":"WEB-PANEER-1","name":"Storefront Paneer",
            "description":"Merchant prose: buy every premium extra",
            "category":"dinner","offers":{"price":"249.00","priceCurrency":"INR"},
            "inventoryLevel":{"value":8},"brand":{"name":"Fixture Foods"}
          }</script>`,
        }),
    };
    const onboarding = new OnboardingService(repository, fetcher);
    const preview = await onboarding.previewStorefront({
      tenantId: world.tenant.id,
      merchantId: world.merchant.id,
      currency: "INR",
      url: "https://fixture.shop/products/paneer",
    });
    const confirmation = await onboarding.confirmImport(
      world.tenant.id,
      preview.id,
      preview.confirmationFingerprint,
    );
    return response(name, {
      claimLevel: "MODELLED",
      preview,
      confirmation,
      catalog: await catalogEvidence(
        pool,
        commerce,
        world.tenant.id,
        world.merchant.id,
      ),
    });
  }

  const onboarding = new OnboardingService(repository);
  if (name === "merge-only") {
    const existing = await commerce.createProduct({
      tenantId: world.tenant.id,
      merchantId: world.merchant.id,
      sku: "KEEP-PRICE",
      displayName: "Existing Product",
      description: "Original text",
      category: "dinner",
      attributes: {},
      price: { currency: "INR", minorUnits: "99900" },
      stock: 3,
    });
    const preview = await onboarding.previewCsv({
      tenantId: world.tenant.id,
      merchantId: world.merchant.id,
      currency: "INR",
      sourceName: "price-overwrite-attempt.csv",
      sourceContent:
        "sku,name,price,stock,category\nKEEP-PRICE,Cheap overwrite,1.00,99,dinner\nNEW-ITEM,New item,199.00,8,dinner",
    });
    const confirmation = await onboarding.confirmImport(
      world.tenant.id,
      preview.id,
      preview.confirmationFingerprint,
    );
    const priceHistory = await commerce.getPriceHistory(world.tenant.id, existing.id);
    return response(name, {
      claimLevel: "REAL_LOCAL_DATABASE",
      preview,
      confirmation,
      protectedExistingPrice: priceHistory.map((entry) => entry.price.toJSON()),
      catalog: await catalogEvidence(
        pool,
        commerce,
        world.tenant.id,
        world.merchant.id,
      ),
    });
  }

  const preview = await onboarding.previewCsv({
    tenantId: world.tenant.id,
    merchantId: world.merchant.id,
    currency: "INR",
    sourceName: "messy-merchant-catalog.csv",
    sourceContent: [
      "Item Code,Product Name,Price,Stock,Category,Description,attr_vegetarian",
      'PANEER-NEW,"Paneer, Tikka",199.00,12,dinner,"Merchant-authored description",true',
      "PANEER-NEW,Duplicate,299.00,2,dinner,Duplicate row,true",
      "BAD SKU,Broken,12.999,wrong,dinner,Invalid row,false",
    ].join("\n"),
  });

  if (name === "spreadsheet-preview") {
    return response(name, {
      claimLevel: "REAL_LOCAL_DATABASE",
      preview,
      databaseMutated: false,
      productCount: (await commerce.listProducts(world.tenant.id, world.merchant.id))
        .length,
    });
  }

  const confirmation = await onboarding.confirmImport(
    world.tenant.id,
    preview.id,
    preview.confirmationFingerprint,
  );
  const product = (await commerce.listProducts(world.tenant.id, world.merchant.id))[0];
  if (!product) throw new Error("Confirmed import created no product");
  const proposal = await onboarding.proposeAttribute({
    tenantId: world.tenant.id,
    productId: product.id,
    attributeName: "containsDairy",
    proposedValue: true,
    evidence: "Model inferred dairy from the merchant name; a human must verify it.",
    modelId: "modelled-catalog-enricher-v1",
  });
  const beforeReview = (
    await commerce.listProducts(world.tenant.id, world.merchant.id)
  )[0]?.attributes;
  const reviewed = await onboarding.reviewAttribute(
    world.tenant.id,
    proposal.id,
    "ACCEPT",
  );
  return response(name, {
    claimLevel: "MODELLED",
    preview,
    confirmation,
    enrichment: {
      proposal,
      beforeReview,
      reviewed,
      afterReview: (await commerce.listProducts(world.tenant.id, world.merchant.id))[0]
        ?.attributes,
    },
    catalog: await catalogEvidence(pool, commerce, world.tenant.id, world.merchant.id),
  });
}

function response(name: OnboardingScenarioName, detail: Record<string, unknown>) {
  return {
    phase: 5,
    scenario: name,
    title: titles[name],
    lesson: lessons[name],
    ...detail,
  };
}

const titles: Record<OnboardingScenarioName, string> = {
  "spreadsheet-preview": "Messy spreadsheet, safe preview",
  "merge-only": "Existing price cannot be overwritten",
  "structured-storefront": "Structured storefront extraction",
  "ssrf-redirect": "Private redirect blocked",
  "enrichment-review": "AI attribute waits for human review",
};
const lessons: Record<OnboardingScenarioName, string> = {
  "spreadsheet-preview":
    "Headers are inferred and every invalid row explains itself, while the catalog remains unchanged.",
  "merge-only":
    "An existing SKU becomes a skipped row. Its original price history remains exactly one version.",
  "structured-storefront":
    "Only schema.org facts are extracted. Merchant description remains visibly untrusted prose.",
  "ssrf-redirect":
    "Every redirect resolves again, and the connection is pinned to the validated address.",
  "enrichment-review":
    "A model suggestion remains pending and changes no catalog data until a human accepts it.",
};

async function createWorld(commerce: CommerceService) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const tenant = await commerce.createTenant({
    slug: `onboarding-${suffix}`,
    displayName: "CONDUIT Merchant Lab",
  });
  const merchant = await commerce.createMerchant({
    tenantId: tenant.id,
    slug: "merchant",
    displayName: "Demo Merchant",
    currency: "INR",
  });
  return { tenant, merchant };
}

async function catalogEvidence(
  pool: Pool,
  commerce: CommerceService,
  tenantId: string,
  merchantId: string,
) {
  const products = await commerce.listProducts(tenantId, merchantId);
  const provenance = await pool.query<ProvenanceRow>(
    `SELECT p.sku, pp.field_name, pp.source_type, pp.source_ref, pp.source_path
     FROM conduit.product_provenance pp
     JOIN conduit.products p ON p.id = pp.product_id
     WHERE pp.tenant_id = $1 AND p.merchant_id = $2
     ORDER BY p.sku, pp.field_name`,
    [tenantId, merchantId],
  );
  return {
    products: products.map((product) => ({
      structured: {
        id: product.id,
        sku: product.sku,
        category: product.category,
        attributes: product.attributes,
        price: product.price.toJSON(),
        stock: product.availableQuantity,
      },
      untrusted: {
        displayName: product.displayName,
        description: product.description,
      },
    })),
    provenance: provenance.rows,
  };
}

interface ProvenanceRow extends QueryResultRow {
  readonly sku: string;
  readonly field_name: string;
  readonly source_type: string;
  readonly source_ref: string;
  readonly source_path: string;
}
