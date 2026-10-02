import { z } from "zod";

import { moneySchema, nonNegativeMoneySchema } from "./money-contract.js";

const slugSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "Invalid slug");

const entityIdSchema = z.uuid();

export const createTenantSchema = z
  .object({
    slug: slugSchema,
    displayName: z.string().trim().min(1).max(120),
  })
  .strict();

export const createMerchantSchema = z
  .object({
    tenantId: entityIdSchema,
    slug: slugSchema,
    displayName: z.string().trim().min(1).max(120),
    currency: z.string().regex(/^[A-Z]{3}$/u),
  })
  .strict();

const attributeValueSchema = z.union([
  z.string().max(200),
  z.boolean(),
  z.array(z.string().max(100)).max(50),
]);

export const createProductSchema = z
  .object({
    tenantId: entityIdSchema,
    merchantId: entityIdSchema,
    sku: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/u),
    displayName: z.string().trim().min(1).max(200),
    description: z.string().max(5_000),
    category: z.string().trim().min(1).max(100),
    attributes: z.record(z.string().min(1).max(80), attributeValueSchema),
    price: nonNegativeMoneySchema,
    stock: z.int().min(0).max(1_000_000),
  })
  .strict();

export const changePriceSchema = z
  .object({
    tenantId: entityIdSchema,
    productId: entityIdSchema,
    price: nonNegativeMoneySchema,
  })
  .strict();

export const createCartSchema = z
  .object({
    tenantId: entityIdSchema,
    merchantId: entityIdSchema,
  })
  .strict();

export const setCartLineSchema = z
  .object({
    tenantId: entityIdSchema,
    cartId: entityIdSchema,
    productId: entityIdSchema,
    quantity: z.int().min(1).max(999),
  })
  .strict();

export const cartCommandSchema = z
  .object({
    tenantId: entityIdSchema,
    cartId: entityIdSchema,
  })
  .strict();

export { moneySchema };

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type CreateMerchantInput = z.infer<typeof createMerchantSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type ChangePriceInput = z.infer<typeof changePriceSchema>;
export type CreateCartInput = z.infer<typeof createCartSchema>;
export type SetCartLineInput = z.infer<typeof setCartLineSchema>;
export type CartCommandInput = z.infer<typeof cartCommandSchema>;
