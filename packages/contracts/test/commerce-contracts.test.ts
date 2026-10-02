import { describe, expect, it } from "vitest";

import { createProductSchema, setCartLineSchema } from "../src/index.js";

const tenantId = "b88ce32c-e5cc-48fd-83d4-65028c30fbcb";
const merchantId = "9e858a74-354f-4a96-a1a9-ae6719b4fb24";

describe("commerce contracts", () => {
  it("accepts structured product truth and merchant prose separately", () => {
    const result = createProductSchema.parse({
      tenantId,
      merchantId,
      sku: "PANEER-01",
      displayName: "Paneer Tikka",
      description: "Merchant-authored description",
      category: "dinner",
      attributes: { vegetarian: true, allergens: ["milk"] },
      price: { currency: "INR", minorUnits: "19900" },
      stock: 20,
    });

    expect(result.attributes.vegetarian).toBe(true);
  });

  it("rejects an agent-supplied price on a cart mutation", () => {
    const result = setCartLineSchema.safeParse({
      tenantId,
      cartId: "00889ea4-6952-4397-9f37-b6737b97504b",
      productId: "3f09c6fd-6601-4f5f-a29c-fda7b3f607da",
      quantity: 2,
      price: { currency: "INR", minorUnits: "1" },
    });

    expect(result.success).toBe(false);
  });
});
