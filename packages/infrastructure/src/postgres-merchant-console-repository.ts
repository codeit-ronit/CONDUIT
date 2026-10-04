import type {
  MerchantCatalogRepository,
  MerchantCatalogSnapshot,
  MerchantCredential,
  MerchantIdentityRepository,
  MerchantProductView,
  MerchantRole,
  MerchantSessionPrincipal,
  ProductProvenanceView,
  ProvisionMerchantUser,
} from "@conduit/merchant-console";
import type { Pool, QueryResultRow } from "pg";

interface CredentialRow extends QueryResultRow {
  readonly id: string;
  readonly email: string;
  readonly display_name: string;
  readonly password_salt: string;
  readonly password_digest: string;
}

interface SessionRow extends QueryResultRow {
  readonly session_id: string;
  readonly user_id: string;
  readonly email: string;
  readonly display_name: string;
  readonly tenant_id: string;
  readonly merchant_id: string;
  readonly merchant_name: string;
  readonly role: MerchantRole;
  readonly expires_at: Date;
}

interface MerchantRow extends QueryResultRow {
  readonly id: string;
  readonly display_name: string;
  readonly currency: string;
}

interface ProductRow extends QueryResultRow {
  readonly id: string;
  readonly sku: string;
  readonly display_name: string;
  readonly description: string;
  readonly category: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly currency: string;
  readonly minor_units: string;
  readonly price_version: number;
  readonly available_quantity: number;
}

interface ProvenanceRow extends QueryResultRow {
  readonly product_id: string;
  readonly field_name: string;
  readonly source_type: ProductProvenanceView["sourceType"];
  readonly source_ref: string;
  readonly source_digest: string;
  readonly source_path: string;
  readonly observed_value: unknown;
  readonly recorded_at: Date;
}

interface SummaryRow extends QueryResultRow {
  readonly confirmed_imports: number;
  readonly pending_enrichments: number;
}

export class PostgresMerchantIdentityRepository implements MerchantIdentityRepository {
  public constructor(private readonly pool: Pool) {}

  public async provisionUser(input: ProvisionMerchantUser): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const previous = await client.query<{
        readonly id: string;
        readonly password_digest: string;
      }>(
        `SELECT id, password_digest
         FROM conduit.merchant_users
         WHERE email = lower($1)
         FOR UPDATE`,
        [input.email],
      );
      const user = await client.query<{ readonly id: string }>(
        `INSERT INTO conduit.merchant_users (
           email, display_name, password_salt, password_digest
         ) VALUES (lower($1), $2, $3, $4)
         ON CONFLICT (email) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             password_salt = EXCLUDED.password_salt,
             password_digest = EXCLUDED.password_digest,
             updated_at = clock_timestamp()
         RETURNING id`,
        [input.email, input.displayName, input.passwordSalt, input.passwordDigest],
      );
      const userId = required(user.rows[0], "merchant user").id;
      if (
        previous.rows[0] &&
        previous.rows[0].password_digest !== input.passwordDigest
      ) {
        await client.query(
          `UPDATE conduit.browser_sessions
           SET revoked_at = COALESCE(revoked_at, clock_timestamp())
           WHERE user_id = $1`,
          [userId],
        );
      }
      const membership = await client.query(
        `INSERT INTO conduit.merchant_memberships (
           user_id, tenant_id, merchant_id, role
         )
         SELECT $1, m.tenant_id, m.id, $4
         FROM conduit.merchants m
         WHERE m.tenant_id = $2 AND m.id = $3
         ON CONFLICT (user_id) DO UPDATE
         SET tenant_id = EXCLUDED.tenant_id,
             merchant_id = EXCLUDED.merchant_id,
             role = EXCLUDED.role
         RETURNING user_id`,
        [userId, input.tenantId, input.merchantId, input.role],
      );
      if (membership.rowCount !== 1) throw new Error("Merchant scope was not found");
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async findCredential(email: string): Promise<MerchantCredential | null> {
    const result = await this.pool.query<CredentialRow>(
      `SELECT id, email, display_name, password_salt, password_digest
       FROM conduit.merchant_users
       WHERE email = lower($1)`,
      [email],
    );
    const row = result.rows[0];
    return row
      ? {
          userId: row.id,
          email: row.email,
          displayName: row.display_name,
          passwordSalt: row.password_salt,
          passwordDigest: row.password_digest,
        }
      : null;
  }

  public async createSession(input: {
    readonly userId: string;
    readonly tokenDigest: string;
    readonly expiresAt: Date;
  }): Promise<MerchantSessionPrincipal> {
    const result = await this.pool.query<SessionRow>(
      `WITH inserted AS (
         INSERT INTO conduit.browser_sessions (user_id, token_digest, expires_at)
         VALUES ($1, $2, $3)
         RETURNING id, user_id, expires_at
       )
       SELECT s.id AS session_id, u.id AS user_id, u.email, u.display_name,
              mm.tenant_id, mm.merchant_id, m.display_name AS merchant_name,
              mm.role, s.expires_at
       FROM inserted s
       JOIN conduit.merchant_users u ON u.id = s.user_id
       JOIN conduit.merchant_memberships mm ON mm.user_id = u.id
       JOIN conduit.merchants m
         ON m.tenant_id = mm.tenant_id AND m.id = mm.merchant_id`,
      [input.userId, input.tokenDigest, input.expiresAt],
    );
    return mapSession(required(result.rows[0], "merchant membership for session"));
  }

  public async findActiveSession(
    tokenDigest: string,
  ): Promise<MerchantSessionPrincipal | null> {
    const result = await this.pool.query<SessionRow>(
      `WITH active AS (
         UPDATE conduit.browser_sessions
         SET last_seen_at = clock_timestamp()
         WHERE token_digest = $1
           AND revoked_at IS NULL
           AND expires_at > clock_timestamp()
         RETURNING id, user_id, expires_at
       )
       SELECT s.id AS session_id, u.id AS user_id, u.email, u.display_name,
              mm.tenant_id, mm.merchant_id, m.display_name AS merchant_name,
              mm.role, s.expires_at
       FROM active s
       JOIN conduit.merchant_users u ON u.id = s.user_id
       JOIN conduit.merchant_memberships mm ON mm.user_id = u.id
       JOIN conduit.merchants m
         ON m.tenant_id = mm.tenant_id AND m.id = mm.merchant_id`,
      [tokenDigest],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  public async revokeSession(tokenDigest: string): Promise<void> {
    await this.pool.query(
      `UPDATE conduit.browser_sessions
       SET revoked_at = COALESCE(revoked_at, clock_timestamp())
       WHERE token_digest = $1`,
      [tokenDigest],
    );
  }
}

export class PostgresMerchantCatalogRepository implements MerchantCatalogRepository {
  public constructor(private readonly pool: Pool) {}

  public async loadCatalog(
    tenantId: string,
    merchantId: string,
  ): Promise<MerchantCatalogSnapshot> {
    const [merchantResult, productResult, provenanceResult, summaryResult] =
      await Promise.all([
        this.pool.query<MerchantRow>(
          `SELECT id, display_name, currency
           FROM conduit.merchants
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, merchantId],
        ),
        this.pool.query<ProductRow>(
          `SELECT p.id, p.sku, p.display_name, p.description, p.category,
                  p.attributes, pp.currency, pp.minor_units::text,
                  pp.version AS price_version, i.available_quantity
           FROM conduit.products p
           JOIN conduit.product_prices pp
             ON pp.tenant_id = p.tenant_id AND pp.product_id = p.id
            AND pp.valid_to IS NULL
           JOIN conduit.inventory i
             ON i.tenant_id = p.tenant_id AND i.product_id = p.id
           WHERE p.tenant_id = $1 AND p.merchant_id = $2 AND p.active = true
           ORDER BY p.display_name, p.id`,
          [tenantId, merchantId],
        ),
        this.pool.query<ProvenanceRow>(
          `SELECT pp.product_id, pp.field_name, pp.source_type, pp.source_ref,
                  pp.source_digest, pp.source_path, pp.observed_value, pp.recorded_at
           FROM conduit.product_provenance pp
           JOIN conduit.products p
             ON p.tenant_id = pp.tenant_id AND p.id = pp.product_id
           WHERE p.tenant_id = $1 AND p.merchant_id = $2 AND p.active = true
           ORDER BY pp.product_id, pp.field_name, pp.id`,
          [tenantId, merchantId],
        ),
        this.pool.query<SummaryRow>(
          `SELECT
             (SELECT count(*)::integer
              FROM conduit.catalog_imports ci
              WHERE ci.tenant_id = $1 AND ci.merchant_id = $2
                AND ci.status = 'CONFIRMED') AS confirmed_imports,
             (SELECT count(*)::integer
              FROM conduit.attribute_enrichment_proposals aep
              JOIN conduit.products p
                ON p.tenant_id = aep.tenant_id AND p.id = aep.product_id
              WHERE p.tenant_id = $1 AND p.merchant_id = $2
                AND aep.status = 'PENDING') AS pending_enrichments`,
          [tenantId, merchantId],
        ),
      ]);
    const merchant = required(merchantResult.rows[0], "scoped merchant");
    const provenance = new Map<string, ProductProvenanceView[]>();
    for (const row of provenanceResult.rows) {
      const items = provenance.get(row.product_id) ?? [];
      items.push({
        fieldName: row.field_name,
        sourceType: row.source_type,
        sourceRef: row.source_ref,
        sourceDigest: row.source_digest,
        sourcePath: row.source_path,
        observedValue: row.observed_value,
        recordedAt: row.recorded_at.toISOString(),
      });
      provenance.set(row.product_id, items);
    }
    const products: MerchantProductView[] = productResult.rows.map((row) => ({
      id: row.id,
      sku: row.sku,
      displayName: row.display_name,
      description: row.description,
      category: row.category,
      attributes: row.attributes,
      price: { currency: row.currency, minorUnits: row.minor_units },
      priceVersion: row.price_version,
      availableQuantity: row.available_quantity,
      provenance: provenance.get(row.id) ?? [],
    }));
    const summary = required(summaryResult.rows[0], "merchant catalog summary");
    return {
      merchant: {
        id: merchant.id,
        displayName: merchant.display_name,
        currency: merchant.currency,
      },
      summary: {
        productCount: products.length,
        fieldsWithProvenance: provenanceResult.rows.length,
        confirmedImports: summary.confirmed_imports,
        pendingEnrichments: summary.pending_enrichments,
      },
      products,
    };
  }
}

function mapSession(row: SessionRow): MerchantSessionPrincipal {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    tenantId: row.tenant_id,
    merchantId: row.merchant_id,
    merchantName: row.merchant_name,
    role: row.role,
    expiresAt: row.expires_at.toISOString(),
  };
}

function required<T>(value: T | undefined, name: string): T {
  if (!value) throw new Error(`${name} was not found`);
  return value;
}
