import { z } from "zod";

export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/u, "Currency must be a three-letter uppercase code");

/**
 * JSON has no BigInt. Minor units therefore cross process boundaries as a
 * canonical base-10 integer string and become BigInt inside the domain.
 */
export const moneySchema = z
  .object({
    currency: currencyCodeSchema,
    minorUnits: z.string().regex(/^-?(?:0|[1-9]\d*)$/u, "Invalid integer string"),
  })
  .strict();

export const nonNegativeMoneySchema = moneySchema.refine(
  ({ minorUnits }) => BigInt(minorUnits) >= 0n,
  { message: "Money must not be negative", path: ["minorUnits"] },
);

export type MoneyContract = z.infer<typeof moneySchema>;
