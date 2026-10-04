import type { ImportColumnMapping } from "@conduit/contracts";
import type { ProductAttributes } from "@conduit/domain";

export type ImportSourceType = "CSV" | "XLSX" | "STOREFRONT";
export interface TabularData {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}
export interface MappingProposal {
  readonly mapping: ImportColumnMapping;
  readonly inferredFields: readonly string[];
  readonly missingRequiredFields: readonly ("sku" | "displayName" | "price")[];
}
export type ImportRowReasonCode =
  | "MISSING_REQUIRED_VALUE"
  | "INVALID_SKU"
  | "INVALID_PRICE"
  | "CURRENCY_MISMATCH"
  | "INVALID_STOCK"
  | "DUPLICATE_IN_FILE"
  | "EXISTING_SKU";
export interface NormalizedImportProduct {
  readonly sku: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: string;
  readonly attributes: ProductAttributes;
  readonly currency: string;
  readonly minorUnits: string;
  readonly stock: number;
}
export interface PreviewImportRow {
  readonly rowNumber: number;
  readonly disposition: "READY" | "SKIPPED" | "IMPORTED";
  readonly reasonCode: ImportRowReasonCode | null;
  readonly explanation: string | null;
  readonly raw: Readonly<Record<string, string>>;
  readonly normalized: NormalizedImportProduct | null;
}
export interface CatalogImportPreview {
  readonly id: string;
  readonly tenantId: string;
  readonly merchantId: string;
  readonly sourceType: ImportSourceType;
  readonly sourceName: string;
  readonly sourceDigest: string;
  readonly mapping: ImportColumnMapping;
  readonly confirmationFingerprint: string;
  readonly status: "PREVIEWED" | "CONFIRMED";
  readonly rows: readonly PreviewImportRow[];
}
export interface ImportConfirmationResult {
  readonly importId: string;
  readonly status: "CONFIRMED" | "REPLAYED";
  readonly imported: number;
  readonly skipped: number;
  readonly rows: readonly PreviewImportRow[];
}
export interface CreateImportPreview {
  readonly tenantId: string;
  readonly merchantId: string;
  readonly sourceType: ImportSourceType;
  readonly sourceName: string;
  readonly sourceDigest: string;
  readonly mapping: ImportColumnMapping;
  readonly confirmationFingerprint: string;
  readonly rows: readonly PreviewImportRow[];
}
export interface OnboardingRepository {
  createPreview(input: CreateImportPreview): Promise<CatalogImportPreview>;
  confirmImport(
    tenantId: string,
    importId: string,
    confirmationFingerprint: string,
  ): Promise<ImportConfirmationResult>;
  proposeAttribute(
    input: AttributeEnrichmentInput,
  ): Promise<AttributeEnrichmentProposal>;
  reviewAttribute(
    tenantId: string,
    proposalId: string,
    decision: "ACCEPT" | "REJECT",
  ): Promise<AttributeEnrichmentProposal>;
}
export interface AttributeEnrichmentInput {
  readonly tenantId: string;
  readonly productId: string;
  readonly attributeName: string;
  readonly proposedValue: string | boolean | readonly string[];
  readonly evidence: string;
  readonly modelId: string;
}
export interface AttributeEnrichmentProposal extends AttributeEnrichmentInput {
  readonly id: string;
  readonly status: "PENDING" | "ACCEPTED" | "REJECTED";
}
export interface StorefrontDocument {
  readonly finalUrl: string;
  readonly html: string;
  readonly redirects: readonly string[];
  readonly contentType: string;
}
export interface StorefrontFetcher {
  fetch(url: string): Promise<StorefrontDocument>;
}
