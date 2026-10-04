import { z } from "zod";

const entityIdSchema = z.uuid();

export const importColumnMappingSchema = z
  .object({
    sku: z.string().min(1),
    displayName: z.string().min(1),
    description: z.string().min(1).nullable(),
    category: z.string().min(1).nullable(),
    price: z.string().min(1),
    priceUnit: z.enum(["MAJOR", "MINOR"]),
    currency: z.string().min(1).nullable(),
    stock: z.string().min(1).nullable(),
    attributeColumns: z.record(z.string().min(1), z.string().min(1).max(80)),
  })
  .strict();

export const confirmCatalogImportSchema = z
  .object({
    tenantId: entityIdSchema,
    importId: entityIdSchema,
    confirmationFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

export type ImportColumnMapping = z.infer<typeof importColumnMappingSchema>;
export type ConfirmCatalogImportInput = z.infer<typeof confirmCatalogImportSchema>;
