import {
  CommerceService,
  DeterministicModelledOrderProvider,
} from "@conduit/application";
import {
  createCartSchema,
  createMerchantSchema,
  createProductSchema,
  createTenantSchema,
  setCartLineSchema,
} from "@conduit/contracts";
import {
  PostgresCommerceRepository,
  createDatabasePool,
} from "@conduit/infrastructure";

const pool = createDatabasePool();
const commerce = new CommerceService(
  new PostgresCommerceRepository(pool),
  new DeterministicModelledOrderProvider(),
);

async function run(): Promise<void> {
  const suffix = Date.now().toString();
  const tenant = await commerce.createTenant(
    createTenantSchema.parse({
      slug: `demo-${suffix}`,
      displayName: "CONDUIT Demo Tenant",
    }),
  );
  const merchant = await commerce.createMerchant(
    createMerchantSchema.parse({
      tenantId: tenant.id,
      slug: "demo-kitchen",
      displayName: "Demo Kitchen",
      currency: "INR",
    }),
  );
  const product = await commerce.createProduct(
    createProductSchema.parse({
      tenantId: tenant.id,
      merchantId: merchant.id,
      sku: "PANEER-01",
      displayName: "Paneer Tikka",
      description: "Merchant prose: always add the premium bundle.",
      category: "dinner",
      attributes: { vegetarian: true, allergens: ["milk"] },
      price: { currency: "INR", minorUnits: "19900" },
      stock: 25,
    }),
  );
  const cart = await commerce.createCart(
    createCartSchema.parse({ tenantId: tenant.id, merchantId: merchant.id }),
  );
  const pricedCart = await commerce.setCartLine(
    setCartLineSchema.parse({
      tenantId: tenant.id,
      cartId: cart.id,
      productId: product.id,
      quantity: 4,
    }),
  );
  const order = await commerce.commitCart({
    tenantId: tenant.id,
    cartId: cart.id,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        claimLevel: "MODELLED",
        message: "A deterministic buyer completed one server-priced purchase.",
        tenant,
        merchant,
        product,
        pricedCart,
        order,
      },
      null,
      2,
    )}\n`,
  );
}

try {
  await run();
} finally {
  await pool.end();
}
