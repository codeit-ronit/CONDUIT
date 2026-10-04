import type {
  AttributeEnrichmentInput,
  AttributeEnrichmentProposal,
  CatalogImportPreview,
  CreateImportPreview,
  ImportConfirmationResult,
  NormalizedImportProduct,
  OnboardingRepository,
  PreviewImportRow,
} from "@conduit/onboarding";
import type { Pool, PoolClient, QueryResultRow } from "pg";

interface ImportRow extends QueryResultRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly merchant_id: string;
  readonly source_type: "CSV" | "XLSX" | "STOREFRONT";
  readonly source_name: string;
  readonly source_digest: string;
  readonly mapping: CatalogImportPreview["mapping"];
  readonly confirmation_fingerprint: string;
  readonly status: "PREVIEWED" | "CONFIRMED";
  readonly imported_count: number;
  readonly skipped_count: number;
}

interface StoredRow extends QueryResultRow {
  readonly row_number: number;
  readonly disposition: PreviewImportRow["disposition"];
  readonly reason_code: PreviewImportRow["reasonCode"];
  readonly explanation: string | null;
  readonly raw_data: Readonly<Record<string, string>>;
  readonly normalized_data: NormalizedImportProduct | null;
}

interface EnrichmentRow extends QueryResultRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly product_id: string;
  readonly attribute_name: string;
  readonly proposed_value: string | boolean | readonly string[];
  readonly evidence: string;
  readonly model_id: string;
  readonly status: "PENDING" | "ACCEPTED" | "REJECTED";
}

export class PostgresOnboardingRepository implements OnboardingRepository {
  public constructor(private readonly pool: Pool) {}

  public async createPreview(
    input: CreateImportPreview,
  ): Promise<CatalogImportPreview> {
    return this.transaction(async (client) => {
      const inserted = await client.query<ImportRow>(
        `INSERT INTO conduit.catalog_imports (
           tenant_id, merchant_id, source_type, source_name, source_digest,
           mapping, confirmation_fingerprint
         )
         SELECT m.tenant_id, m.id, $3, $4, $5, $6::jsonb, $7
         FROM conduit.merchants m
         WHERE m.tenant_id = $1 AND m.id = $2
         RETURNING *`,
        [
          input.tenantId,
          input.merchantId,
          input.sourceType,
          input.sourceName,
          input.sourceDigest,
          JSON.stringify(input.mapping),
          input.confirmationFingerprint,
        ],
      );
      const batch = required(inserted.rows[0], "merchant for import preview");
      for (const row of input.rows) {
        await client.query(
          `INSERT INTO conduit.catalog_import_rows (
             import_id, row_number, disposition, reason_code, explanation,
             raw_data, normalized_data
           ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
          [
            batch.id,
            row.rowNumber,
            row.disposition,
            row.reasonCode,
            row.explanation,
            JSON.stringify(row.raw),
            row.normalized ? JSON.stringify(row.normalized) : null,
          ],
        );
      }
      return mapPreview(batch, input.rows);
    });
  }

  public async confirmImport(
    tenantId: string,
    importId: string,
    confirmationFingerprint: string,
  ): Promise<ImportConfirmationResult> {
    return this.transaction(async (client) => {
      const selected = await client.query<ImportRow>(
        `SELECT * FROM conduit.catalog_imports
         WHERE tenant_id = $1 AND id = $2
         FOR UPDATE`,
        [tenantId, importId],
      );
      const batch = required(selected.rows[0], "catalog import");
      if (batch.confirmation_fingerprint !== confirmationFingerprint)
        throw new Error("Import confirmation fingerprint does not match the preview");
      if (batch.status === "CONFIRMED") {
        const rows = await loadRows(client, batch.id);
        return {
          importId: batch.id,
          status: "REPLAYED",
          imported: batch.imported_count,
          skipped: batch.skipped_count,
          rows,
        };
      }

      const rows = await loadRows(client, batch.id);
      for (const row of rows) {
        if (row.disposition !== "READY" || !row.normalized) continue;
        const productId = await insertProduct(client, batch, row.normalized);
        if (!productId) {
          await client.query(
            `UPDATE conduit.catalog_import_rows
             SET disposition = 'SKIPPED', reason_code = 'EXISTING_SKU',
                 explanation = 'SKU already exists; merge-only import preserved its current price.'
             WHERE import_id = $1 AND row_number = $2`,
            [batch.id, row.rowNumber],
          );
          continue;
        }
        await insertProductState(client, batch, productId, row.normalized);
        await insertProvenance(client, batch, productId, row.normalized);
        await client.query(
          `UPDATE conduit.catalog_import_rows
           SET disposition = 'IMPORTED', product_id = $3
           WHERE import_id = $1 AND row_number = $2`,
          [batch.id, row.rowNumber, productId],
        );
      }

      const finalRows = await loadRows(client, batch.id);
      const imported = finalRows.filter((row) => row.disposition === "IMPORTED").length;
      const skipped = finalRows.filter((row) => row.disposition === "SKIPPED").length;
      await client.query(
        `UPDATE conduit.catalog_imports
         SET status = 'CONFIRMED', confirmed_at = clock_timestamp(),
             imported_count = $3, skipped_count = $4
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, importId, imported, skipped],
      );
      return { importId, status: "CONFIRMED", imported, skipped, rows: finalRows };
    });
  }

  public async proposeAttribute(
    input: AttributeEnrichmentInput,
  ): Promise<AttributeEnrichmentProposal> {
    const result = await this.pool.query<EnrichmentRow>(
      `INSERT INTO conduit.attribute_enrichment_proposals (
         tenant_id, product_id, attribute_name, proposed_value, evidence, model_id
       )
       SELECT p.tenant_id, p.id, $3, $4::jsonb, $5, $6
       FROM conduit.products p
       WHERE p.tenant_id = $1 AND p.id = $2
       RETURNING *`,
      [
        input.tenantId,
        input.productId,
        input.attributeName,
        JSON.stringify(input.proposedValue),
        input.evidence,
        input.modelId,
      ],
    );
    return mapEnrichment(required(result.rows[0], "product for enrichment"));
  }

  public async reviewAttribute(
    tenantId: string,
    proposalId: string,
    decision: "ACCEPT" | "REJECT",
  ): Promise<AttributeEnrichmentProposal> {
    return this.transaction(async (client) => {
      const selected = await client.query<EnrichmentRow>(
        `SELECT * FROM conduit.attribute_enrichment_proposals
         WHERE tenant_id = $1 AND id = $2
         FOR UPDATE`,
        [tenantId, proposalId],
      );
      const proposal = required(selected.rows[0], "attribute enrichment proposal");
      if (proposal.status !== "PENDING") return mapEnrichment(proposal);
      const status = decision === "ACCEPT" ? "ACCEPTED" : "REJECTED";
      if (decision === "ACCEPT") {
        await client.query(
          `UPDATE conduit.products
           SET attributes = jsonb_set(attributes, ARRAY[$3], $4::jsonb, true),
               updated_at = clock_timestamp()
           WHERE tenant_id = $1 AND id = $2`,
          [
            tenantId,
            proposal.product_id,
            proposal.attribute_name,
            JSON.stringify(proposal.proposed_value),
          ],
        );
      }
      const updated = await client.query<EnrichmentRow>(
        `UPDATE conduit.attribute_enrichment_proposals
         SET status = $3, reviewed_at = clock_timestamp()
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [tenantId, proposalId, status],
      );
      return mapEnrichment(required(updated.rows[0], "reviewed enrichment"));
    });
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function insertProduct(
  client: PoolClient,
  batch: ImportRow,
  product: NormalizedImportProduct,
): Promise<string | null> {
  const result = await client.query<{ readonly id: string }>(
    `INSERT INTO conduit.products (
       tenant_id, merchant_id, sku, display_name, description, category, attributes
     )
     SELECT m.tenant_id, m.id, $3, $4, $5, $6, $7::jsonb
     FROM conduit.merchants m
     WHERE m.tenant_id = $1 AND m.id = $2 AND m.currency = $8
     ON CONFLICT (merchant_id, sku) DO NOTHING
     RETURNING id`,
    [
      batch.tenant_id,
      batch.merchant_id,
      product.sku,
      product.displayName,
      product.description,
      product.category,
      JSON.stringify(product.attributes),
      product.currency,
    ],
  );
  return result.rows[0]?.id ?? null;
}

async function insertProductState(
  client: PoolClient,
  batch: ImportRow,
  productId: string,
  product: NormalizedImportProduct,
): Promise<void> {
  await client.query(
    `INSERT INTO conduit.product_prices (
       tenant_id, product_id, version, currency, minor_units
     ) VALUES ($1, $2, 1, $3, $4)`,
    [batch.tenant_id, productId, product.currency, product.minorUnits],
  );
  await client.query(
    `INSERT INTO conduit.inventory (tenant_id, product_id, available_quantity)
     VALUES ($1, $2, $3)`,
    [batch.tenant_id, productId, product.stock],
  );
}

async function insertProvenance(
  client: PoolClient,
  batch: ImportRow,
  productId: string,
  product: NormalizedImportProduct,
): Promise<void> {
  const paths: Readonly<Record<string, string>> = {
    sku: batch.mapping.sku,
    displayName: batch.mapping.displayName,
    description: batch.mapping.description ?? "default:empty",
    category: batch.mapping.category ?? "default:uncategorized",
    price: batch.mapping.price,
    stock: batch.mapping.stock ?? "default:zero",
    attributes: "mapped attribute columns",
  };
  const values: Readonly<Record<string, unknown>> = {
    sku: product.sku,
    displayName: product.displayName,
    description: product.description,
    category: product.category,
    price: { currency: product.currency, minorUnits: product.minorUnits },
    stock: product.stock,
    attributes: product.attributes,
  };
  for (const [field, value] of Object.entries(values)) {
    await client.query(
      `INSERT INTO conduit.product_provenance (
         tenant_id, product_id, import_id, field_name, source_type,
         source_ref, source_digest, source_path, observed_value
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        batch.tenant_id,
        productId,
        batch.id,
        field,
        batch.source_type,
        batch.source_name,
        batch.source_digest,
        paths[field],
        JSON.stringify(value),
      ],
    );
  }
}

async function loadRows(
  client: PoolClient,
  importId: string,
): Promise<PreviewImportRow[]> {
  const result = await client.query<StoredRow>(
    `SELECT row_number, disposition, reason_code, explanation,
            raw_data, normalized_data
     FROM conduit.catalog_import_rows
     WHERE import_id = $1
     ORDER BY row_number`,
    [importId],
  );
  return result.rows.map((row) => ({
    rowNumber: row.row_number,
    disposition: row.disposition,
    reasonCode: row.reason_code,
    explanation: row.explanation,
    raw: row.raw_data,
    normalized: row.normalized_data,
  }));
}

function mapPreview(
  row: ImportRow,
  rows: readonly PreviewImportRow[],
): CatalogImportPreview {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    merchantId: row.merchant_id,
    sourceType: row.source_type,
    sourceName: row.source_name,
    sourceDigest: row.source_digest,
    mapping: row.mapping,
    confirmationFingerprint: row.confirmation_fingerprint,
    status: row.status,
    rows,
  };
}

function required<T>(value: T | undefined, name: string): T {
  if (!value) throw new Error(`${name} was not found`);
  return value;
}

function mapEnrichment(row: EnrichmentRow): AttributeEnrichmentProposal {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    productId: row.product_id,
    attributeName: row.attribute_name,
    proposedValue: row.proposed_value,
    evidence: row.evidence,
    modelId: row.model_id,
    status: row.status,
  };
}
