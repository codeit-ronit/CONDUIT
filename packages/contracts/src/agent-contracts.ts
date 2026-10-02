import { z } from "zod";

const entityIdSchema = z.uuid();

export const shoppingIntentProposalSchema = z
  .object({
    schemaVersion: z.literal("buyer-intent-v1"),
    merchantId: entityIdSchema,
    currency: z.string().regex(/^[A-Z]{3}$/u),
    maximumMinorUnits: z.string().regex(/^\d+$/u),
    category: z.string().trim().min(1).max(100),
    quantity: z.int().min(1).max(999),
    excludedTerms: z.array(z.string().trim().min(1).max(100)).max(50),
    requiredAttributes: z.record(z.string(), z.string()),
    summary: z.string().trim().min(1).max(500),
  })
  .strict();

/**
 * One object shape is intentional: OpenAI Structured Outputs does not accept a
 * root-level discriminated union. Fields that do not apply to an action are null.
 */
export const buyerActionSchema = z
  .object({
    kind: z.enum(["SELECT_PRODUCT", "COMMIT", "REFUSE"]),
    productId: entityIdSchema.nullable(),
    quantity: z.int().min(1).max(999).nullable(),
    statedTotalMinorUnits: z.string().regex(/^\d+$/u).nullable(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type ShoppingIntentProposal = z.infer<typeof shoppingIntentProposalSchema>;
export type BuyerAction = z.infer<typeof buyerActionSchema>;
