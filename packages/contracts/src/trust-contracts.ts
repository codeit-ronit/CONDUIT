import { z } from "zod";

import { moneySchema, nonNegativeMoneySchema } from "./money-contract.js";

const entityIdSchema = z.uuid();

export const createBuyerSchema = z
  .object({
    tenantId: entityIdSchema,
    displayName: z.string().trim().min(1).max(120),
  })
  .strict();

export const createAuthorizationGrantSchema = z
  .object({
    tenantId: entityIdSchema,
    buyerId: entityIdSchema,
    merchantId: entityIdSchema,
    maximumAmount: nonNegativeMoneySchema,
    allowedCategories: z.array(z.string().trim().min(1).max(100)).max(100),
    allowedSkus: z.array(z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/u)).max(500),
    expiresAt: z.iso.datetime({ offset: true }),
    policyVersion: z.literal("trust-v1"),
  })
  .strict();

const quotedLineSchema = z
  .object({
    productId: entityIdSchema,
    sku: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/u),
    quantity: z.int().min(1).max(999),
    unitPrice: nonNegativeMoneySchema,
    lineTotal: nonNegativeMoneySchema,
    priceVersion: z.int().positive(),
  })
  .strict();

export const trustedCommitSchema = z
  .object({
    tenantId: entityIdSchema,
    cartId: entityIdSchema,
    grantId: entityIdSchema,
    operationKey: z
      .string()
      .min(8)
      .max(120)
      .regex(/^[A-Za-z0-9._:-]+$/u),
    quote: z
      .object({
        currency: z.string().regex(/^[A-Z]{3}$/u),
        lines: z.array(quotedLineSchema).min(1).max(100),
        statedTotal: moneySchema,
      })
      .strict(),
  })
  .strict();

export type CreateBuyerInput = z.infer<typeof createBuyerSchema>;
export type CreateAuthorizationGrantInput = z.infer<
  typeof createAuthorizationGrantSchema
>;
export type TrustedCommitInput = z.infer<typeof trustedCommitSchema>;
