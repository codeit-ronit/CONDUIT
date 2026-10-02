import { describe, expect, it } from "vitest";

import { CurrencyMismatchError, InvalidMoneyError, Money } from "../src/index.js";

describe("Money", () => {
  it("stores exact integer minor units", () => {
    const price = Money.fromMinorUnits("INR", 19_900n);

    expect(price.currency).toBe("INR");
    expect(price.minorUnits).toBe(19_900n);
  });

  it("rejects a floating-point value even when TypeScript is bypassed", () => {
    expect(() => Money.fromMinorUnits("INR", 199.99 as unknown as bigint)).toThrow(
      InvalidMoneyError,
    );
  });

  it("rejects malformed currency codes", () => {
    expect(() => Money.fromMinorUnits("inr", 100n)).toThrow(InvalidMoneyError);
    expect(() => Money.fromMinorUnits("RUPEE", 100n)).toThrow(InvalidMoneyError);
  });

  it("returns a new exact value when adding money", () => {
    const first = Money.fromMinorUnits("INR", 10_001n);
    const second = Money.fromMinorUnits("INR", 20_002n);

    const total = first.add(second);

    expect(total.equals(Money.fromMinorUnits("INR", 30_003n))).toBe(true);
    expect(first.minorUnits).toBe(10_001n);
  });

  it("refuses implicit currency conversion", () => {
    const rupees = Money.fromMinorUnits("INR", 100n);
    const dollars = Money.fromMinorUnits("USD", 100n);

    expect(() => rupees.add(dollars)).toThrow(CurrencyMismatchError);
  });

  it("multiplies only by an integer quantity", () => {
    const unitPrice = Money.fromMinorUnits("INR", 19_900n);

    expect(unitPrice.multiply(4n).minorUnits).toBe(79_600n);
    expect(() => unitPrice.multiply(4.2 as unknown as bigint)).toThrow(
      InvalidMoneyError,
    );
  });

  it("serializes BigInt safely as a decimal string", () => {
    const price = Money.fromMinorUnits("INR", 19_900n);

    expect(JSON.stringify(price)).toBe('{"currency":"INR","minorUnits":"19900"}');
  });
});
