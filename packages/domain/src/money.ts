const ISO_4217_CODE = /^[A-Z]{3}$/u;

export interface MoneyJson {
  readonly currency: string;
  readonly minorUnits: string;
}

export class InvalidMoneyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidMoneyError";
  }
}

export class CurrencyMismatchError extends Error {
  public constructor(leftCurrency: string, rightCurrency: string) {
    super(`Cannot combine ${leftCurrency} with ${rightCurrency}`);
    this.name = "CurrencyMismatchError";
  }
}

/**
 * An immutable monetary value expressed only in integer minor units.
 *
 * For INR, `19900n` means ₹199.00. BigInt is deliberate: it cannot represent a
 * fraction and it does not lose precision for large integer values.
 */
export class Money {
  readonly #currency: string;
  readonly #minorUnits: bigint;

  private constructor(currency: string, minorUnits: bigint) {
    this.#currency = currency;
    this.#minorUnits = minorUnits;
    Object.freeze(this);
  }

  public static fromMinorUnits(currency: string, minorUnits: bigint): Money {
    if (!ISO_4217_CODE.test(currency)) {
      throw new InvalidMoneyError(
        `Currency must be a three-letter uppercase code; received ${JSON.stringify(currency)}`,
      );
    }

    // TypeScript protects normal callers; this runtime check protects API or
    // plain-JavaScript callers that bypass the compile-time type.
    if (typeof minorUnits !== "bigint") {
      throw new InvalidMoneyError("Minor units must be a bigint integer");
    }

    return new Money(currency, minorUnits);
  }

  public get currency(): string {
    return this.#currency;
  }

  public get minorUnits(): bigint {
    return this.#minorUnits;
  }

  public add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromMinorUnits(this.currency, this.minorUnits + other.minorUnits);
  }

  public subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromMinorUnits(this.currency, this.minorUnits - other.minorUnits);
  }

  public multiply(quantity: bigint): Money {
    if (typeof quantity !== "bigint") {
      throw new InvalidMoneyError("Quantity must be a bigint integer");
    }

    return Money.fromMinorUnits(this.currency, this.minorUnits * quantity);
  }

  public equals(other: Money): boolean {
    return this.currency === other.currency && this.minorUnits === other.minorUnits;
  }

  public toJSON(): MoneyJson {
    return {
      currency: this.currency,
      minorUnits: this.minorUnits.toString(),
    };
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
