import type { ImportColumnMapping } from "@conduit/contracts";

import { parseCsv } from "./csv.js";
import { confirmationFingerprint, previewTable, sourceDigest } from "./preview.js";
import type {
  AttributeEnrichmentInput,
  CatalogImportPreview,
  ImportConfirmationResult,
  ImportSourceType,
  OnboardingRepository,
  TabularData,
  StorefrontFetcher,
} from "./types.js";
import { extractStorefrontProducts } from "./storefront.js";
import { parseXlsx } from "./xlsx.js";

export interface PreviewTableInput {
  readonly tenantId: string;
  readonly merchantId: string;
  readonly currency: string;
  readonly sourceType: ImportSourceType;
  readonly sourceName: string;
  readonly sourceContent: string | Uint8Array;
  readonly table: TabularData;
  readonly mapping?: ImportColumnMapping;
}

export class OnboardingService {
  public constructor(
    private readonly repository: OnboardingRepository,
    private readonly storefrontFetcher?: StorefrontFetcher,
  ) {}

  public previewCsv(
    input: Omit<PreviewTableInput, "sourceType" | "table" | "sourceContent"> & {
      readonly sourceContent: string;
    },
  ) {
    return this.previewTable({
      ...input,
      sourceType: "CSV",
      table: parseCsv(input.sourceContent),
    });
  }

  public async previewTable(input: PreviewTableInput): Promise<CatalogImportPreview> {
    const digest = sourceDigest(input.sourceContent);
    const preview = previewTable(input.table, input.currency, input.mapping);
    if (preview.proposal.missingRequiredFields.length > 0) {
      throw new Error(
        `Confirm a corrected mapping for: ${preview.proposal.missingRequiredFields.join(", ")}`,
      );
    }
    const fingerprint = confirmationFingerprint({
      tenantId: input.tenantId,
      merchantId: input.merchantId,
      sourceDigest: digest,
      mapping: preview.proposal.mapping,
      rows: preview.rows,
    });
    return this.repository.createPreview({
      tenantId: input.tenantId,
      merchantId: input.merchantId,
      sourceType: input.sourceType,
      sourceName: input.sourceName,
      sourceDigest: digest,
      mapping: preview.proposal.mapping,
      confirmationFingerprint: fingerprint,
      rows: preview.rows,
    });
  }

  public async previewXlsx(
    input: Omit<PreviewTableInput, "sourceType" | "table" | "sourceContent"> & {
      readonly sourceContent: Uint8Array;
    },
  ): Promise<CatalogImportPreview> {
    return this.previewTable({
      ...input,
      sourceType: "XLSX",
      table: await parseXlsx(input.sourceContent),
    });
  }

  public async previewStorefront(input: {
    readonly tenantId: string;
    readonly merchantId: string;
    readonly currency: string;
    readonly url: string;
  }): Promise<CatalogImportPreview> {
    if (!this.storefrontFetcher) throw new Error("No storefront fetcher is configured");
    const document = await this.storefrontFetcher.fetch(input.url);
    const extracted = extractStorefrontProducts(document);
    return this.previewTable({
      tenantId: input.tenantId,
      merchantId: input.merchantId,
      currency: input.currency,
      sourceType: "STOREFRONT",
      sourceName: document.finalUrl,
      sourceContent: document.html,
      table: extracted.table,
      mapping: extracted.mapping,
    });
  }

  public confirmImport(
    tenantId: string,
    importId: string,
    confirmationFingerprint: string,
  ): Promise<ImportConfirmationResult> {
    return this.repository.confirmImport(tenantId, importId, confirmationFingerprint);
  }

  public proposeAttribute(input: AttributeEnrichmentInput) {
    return this.repository.proposeAttribute(input);
  }

  public reviewAttribute(
    tenantId: string,
    proposalId: string,
    decision: "ACCEPT" | "REJECT",
  ) {
    return this.repository.reviewAttribute(tenantId, proposalId, decision);
  }
}
