import { describe, expect, it } from "vitest";

import {
  CommerceError,
  Money,
  calculateCartTotal,
  calculateLineTotal,
  cartQuantity,
  productSku,
  tenantId,
} from "../src/index.js";

describe("catalog and cart value rules", () => {
  it("accepts explicit machine-safe SKUs", () => {
    expect(productSku("DINNER.PANEER-01")).toBe("DINNER.PANEER-01");
  });

  it.each(["", "lowercase", "HAS SPACE", "@INVALID"])(
    "rejects an unsafe SKU: %s",
    (value) => {
      expect(() => productSku(value)).toThrow(CommerceError);
    },
  );

  it.each([0, -1, 1.5, 1000, Number.NaN])(
    "rejects an invalid cart quantity: %s",
    (value) => {
      expect(() => cartQuantity(value)).toThrow(CommerceError);
    },
  );

  it("computes line and cart totals without floating point", () => {
    const first = calculateLineTotal(
      Money.fromMinorUnits("INR", 19_900n),
      cartQuantity(4),
    );
    const second = calculateLineTotal(
      Money.fromMinorUnits("INR", 5_050n),
      cartQuantity(2),
    );

    expect(
      calculateCartTotal("INR", [{ lineTotal: first }, { lineTotal: second }]),
    ).toEqual(Money.fromMinorUnits("INR", 89_700n));
  });

  it("creates typed identifiers only from UUIDs", () => {
    expect(tenantId("b88ce32c-e5cc-48fd-83d4-65028c30fbcb")).toBe(
      "b88ce32c-e5cc-48fd-83d4-65028c30fbcb",
    );
    expect(() => tenantId("tenant-1")).toThrow(CommerceError);
  });
});
