import type {
  CommerceRepository,
  Merchant,
  ModelledOrder,
  NewProduct,
  PriceHistoryEntry,
  Tenant,
} from "@conduit/application";
import {
  CommerceError,
  CurrencyMismatchError,
  Money,
  calculateCartTotal,
  calculateLineTotal,
  cartId,
  merchantId,
  orderId,
  productId,
  tenantId,
} from "@conduit/domain";
import type {
  CartId,
  CatalogProduct,
  MerchantId,
  PricedCart,
  PricedCartLine,
  ProductAttributes,
  ProductId,
  TenantId,
} from "@conduit/domain";
import type { Pool, PoolClient, QueryResultRow } from "pg";

interface TenantRow extends QueryResultRow {
  readonly id: string;
  readonly slug: string;
  readonly display_name: string;
}

interface MerchantRow extends QueryResultRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly slug: string;
  readonly display_name: string;
  readonly currency: string;
}

interface ProductRow extends QueryResultRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly merchant_id: string;
  readonly sku: string;
  readonly display_name: string;
  readonly description: string;
  readonly category: string;
  readonly attributes: ProductAttributes;
  readonly currency: string;
  readonly minor_units: string;
  readonly price_version: number;
  readonly available_quantity: number;
}

interface PriceRow extends QueryResultRow {
  readonly version: number;
  readonly currency: string;
  readonly minor_units: string;
  readonly valid_from: Date;
  readonly valid_to: Date | null;
}

interface CartHeaderRow extends QueryResultRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly merchant_id: string;
  readonly status: "OPEN" | "COMMITTING" | "COMMITTED";
  readonly currency: string;
}

interface CartLineRow extends QueryResultRow {
  readonly product_id: string;
  readonly sku: string;
  readonly display_name: string;
  readonly quantity: number;
  readonly currency: string;
  readonly minor_units: string;
  readonly price_version: number;
  readonly available_quantity: number;
}

interface OrderRow extends QueryResultRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly merchant_id: string;
  readonly cart_id: string;
  readonly provider_reference: string;
  readonly currency: string;
  readonly total_minor_units: string;
}

interface OrderLineRow extends QueryResultRow {
  readonly product_id: string;
  readonly sku: string;
  readonly display_name: string;
  readonly quantity: number;
  readonly price_version: number;
  readonly currency: string;
  readonly unit_minor_units: string;
  readonly line_minor_units: string;
}

export class PostgresCommerceRepository implements CommerceRepository {
  public constructor(private readonly pool: Pool) {}

  public async createTenant(slug: string, displayName: string): Promise<Tenant> {
    const result = await this.pool.query<TenantRow>(
      `INSERT INTO conduit.tenants (slug, display_name)
       VALUES ($1, $2)
       RETURNING id, slug, display_name`,
      [slug, displayName],
    );

    return mapTenant(requiredRow(result.rows[0], "tenant insert"));
  }

  public async createMerchant(
    scopedTenantId: TenantId,
    slug: string,
    displayName: string,
    currency: string,
  ): Promise<Merchant> {
    const result = await this.pool.query<MerchantRow>(
      `INSERT INTO conduit.merchants (tenant_id, slug, display_name, currency)
       SELECT id, $2, $3, $4
       FROM conduit.tenants
       WHERE id = $1
       RETURNING id, tenant_id, slug, display_name, currency`,
      [scopedTenantId, slug, displayName, currency],
    );

    if (result.rowCount === 0) {
      throw new CommerceError("TENANT_NOT_FOUND", "Tenant does not exist");
    }

    return mapMerchant(requiredRow(result.rows[0], "merchant insert"));
  }

  public async createProduct(product: NewProduct): Promise<CatalogProduct> {
    return this.transaction(async (client) => {
      try {
        const productResult = await client.query<{ readonly id: string }>(
          `INSERT INTO conduit.products (
             tenant_id, merchant_id, sku, display_name, description, category, attributes
           )
           SELECT m.tenant_id, m.id, $3, $4, $5, $6, $7::jsonb
           FROM conduit.merchants m
           WHERE m.tenant_id = $1 AND m.id = $2 AND m.currency = $8
           RETURNING id`,
          [
            product.tenantId,
            product.merchantId,
            product.sku,
            product.displayName,
            product.description,
            product.category,
            JSON.stringify(product.attributes),
            product.price.currency,
          ],
        );

        if (productResult.rowCount === 0) {
          throw new CommerceError(
            "MERCHANT_NOT_FOUND",
            "Merchant does not exist in this tenant or uses another currency",
          );
        }

        const createdProductId = productId(
          requiredRow(productResult.rows[0], "product insert").id,
        );

        await client.query(
          `INSERT INTO conduit.product_prices (
             tenant_id, product_id, version, currency, minor_units
           ) VALUES ($1, $2, 1, $3, $4)`,
          [
            product.tenantId,
            createdProductId,
            product.price.currency,
            product.price.minorUnits.toString(),
          ],
        );
        await client.query(
          `INSERT INTO conduit.inventory (tenant_id, product_id, available_quantity)
           VALUES ($1, $2, $3)`,
          [product.tenantId, createdProductId, product.stock],
        );

        return await this.getProductWithClient(
          client,
          product.tenantId,
          createdProductId,
        );
      } catch (error: unknown) {
        if (postgresErrorCode(error) === "23505") {
          throw new CommerceError(
            "DUPLICATE_SKU",
            "This merchant already has a product with that SKU",
          );
        }

        throw error;
      }
    });
  }

  public async changePrice(
    scopedTenantId: TenantId,
    scopedProductId: ProductId,
    price: Money,
  ): Promise<CatalogProduct> {
    return this.transaction(async (client) => {
      const current = await client.query<PriceRow>(
        `SELECT pp.version, pp.currency, pp.minor_units, pp.valid_from, pp.valid_to
         FROM conduit.product_prices pp
         WHERE pp.tenant_id = $1 AND pp.product_id = $2 AND pp.valid_to IS NULL
         FOR UPDATE`,
        [scopedTenantId, scopedProductId],
      );
      const currentPrice = current.rows[0];

      if (!currentPrice) {
        throw new CommerceError("PRODUCT_NOT_FOUND", "Product does not exist");
      }
      if (currentPrice.currency !== price.currency) {
        throw new CurrencyMismatchError(currentPrice.currency, price.currency);
      }

      await client.query(
        `WITH closed_price AS (
           UPDATE conduit.product_prices
           SET valid_to = clock_timestamp()
           WHERE tenant_id = $1 AND product_id = $2 AND valid_to IS NULL
           RETURNING version, currency, valid_to
         )
         INSERT INTO conduit.product_prices (
           tenant_id, product_id, version, currency, minor_units, valid_from
         )
         SELECT $1, $2, version + 1, currency, $3, valid_to
         FROM closed_price`,
        [scopedTenantId, scopedProductId, price.minorUnits.toString()],
      );

      return this.getProductWithClient(client, scopedTenantId, scopedProductId);
    });
  }

  public async listProducts(
    scopedTenantId: TenantId,
    scopedMerchantId: MerchantId,
  ): Promise<readonly CatalogProduct[]> {
    const result = await this.pool.query<ProductRow>(productQuery("merchant"), [
      scopedTenantId,
      scopedMerchantId,
    ]);

    return result.rows.map(mapProduct);
  }

  public async getPriceHistory(
    scopedTenantId: TenantId,
    scopedProductId: ProductId,
  ): Promise<readonly PriceHistoryEntry[]> {
    const result = await this.pool.query<PriceRow>(
      `SELECT version, currency, minor_units, valid_from, valid_to
       FROM conduit.product_prices
       WHERE tenant_id = $1 AND product_id = $2
       ORDER BY version`,
      [scopedTenantId, scopedProductId],
    );

    if (result.rowCount === 0) {
      throw new CommerceError("PRODUCT_NOT_FOUND", "Product does not exist");
    }

    return result.rows.map((row) => ({
      version: row.version,
      price: Money.fromMinorUnits(row.currency, BigInt(row.minor_units)),
      validFrom: row.valid_from,
      validTo: row.valid_to,
    }));
  }

  public async createCart(
    scopedTenantId: TenantId,
    scopedMerchantId: MerchantId,
  ): Promise<PricedCart> {
    const result = await this.pool.query<{ readonly id: string }>(
      `INSERT INTO conduit.carts (tenant_id, merchant_id)
       SELECT tenant_id, id
       FROM conduit.merchants
       WHERE tenant_id = $1 AND id = $2
       RETURNING id`,
      [scopedTenantId, scopedMerchantId],
    );

    if (result.rowCount === 0) {
      throw new CommerceError("MERCHANT_NOT_FOUND", "Merchant does not exist");
    }

    return this.getCart(
      scopedTenantId,
      cartId(requiredRow(result.rows[0], "cart insert").id),
    );
  }

  public async setCartLine(
    scopedTenantId: TenantId,
    scopedCartId: CartId,
    scopedProductId: ProductId,
    quantity: number,
  ): Promise<PricedCart> {
    const result = await this.pool.query(
      `INSERT INTO conduit.cart_lines (
         tenant_id, merchant_id, cart_id, product_id, quantity
       )
       SELECT c.tenant_id, c.merchant_id, c.id, p.id, $4
       FROM conduit.carts c
       JOIN conduit.products p
         ON p.tenant_id = c.tenant_id AND p.merchant_id = c.merchant_id
       WHERE c.tenant_id = $1 AND c.id = $2 AND c.status = 'OPEN'
         AND p.id = $3 AND p.active = true
       ON CONFLICT (cart_id, product_id)
       DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = clock_timestamp()
       RETURNING cart_id`,
      [scopedTenantId, scopedCartId, scopedProductId, quantity],
    );

    if (result.rowCount === 0) {
      await this.assertOpenCartAndProduct(
        scopedTenantId,
        scopedCartId,
        scopedProductId,
      );
    }

    return this.getCart(scopedTenantId, scopedCartId);
  }

  public async removeCartLine(
    scopedTenantId: TenantId,
    scopedCartId: CartId,
    scopedProductId: ProductId,
  ): Promise<PricedCart> {
    await this.assertOpenCart(scopedTenantId, scopedCartId);
    await this.pool.query(
      `DELETE FROM conduit.cart_lines
       WHERE tenant_id = $1 AND cart_id = $2 AND product_id = $3`,
      [scopedTenantId, scopedCartId, scopedProductId],
    );

    return this.getCart(scopedTenantId, scopedCartId);
  }

  public async replaceCartLines(
    scopedTenantId: TenantId,
    scopedCartId: CartId,
    lines: readonly { readonly productId: ProductId; readonly quantity: number }[],
  ): Promise<PricedCart> {
    return this.transaction(async (client) => {
      const headerResult = await client.query<CartHeaderRow>(
        `${cartHeaderQuery(false)} FOR UPDATE`,
        [scopedTenantId, scopedCartId],
      );
      const header = headerResult.rows[0];
      if (!header) {
        throw new CommerceError("CART_NOT_FOUND", "Cart does not exist");
      }
      if (header.status !== "OPEN") {
        throw new CommerceError("CART_NOT_OPEN", "Cart is already being processed");
      }

      await client.query(
        `DELETE FROM conduit.cart_lines WHERE tenant_id = $1 AND cart_id = $2`,
        [scopedTenantId, scopedCartId],
      );
      for (const line of lines) {
        const inserted = await client.query(
          `INSERT INTO conduit.cart_lines (
             tenant_id, merchant_id, cart_id, product_id, quantity
           )
           SELECT c.tenant_id, c.merchant_id, c.id, p.id, $4
           FROM conduit.carts c
           JOIN conduit.products p
             ON p.tenant_id = c.tenant_id AND p.merchant_id = c.merchant_id
           WHERE c.tenant_id = $1 AND c.id = $2 AND c.status = 'OPEN'
             AND p.id = $3 AND p.active = true`,
          [scopedTenantId, scopedCartId, line.productId, line.quantity],
        );
        if (inserted.rowCount !== 1) {
          throw new CommerceError(
            "PRODUCT_NOT_FOUND",
            "Product does not exist for this merchant",
          );
        }
      }
      return this.getCartWithClient(client, scopedTenantId, scopedCartId);
    });
  }

  public async getCart(
    scopedTenantId: TenantId,
    scopedCartId: CartId,
  ): Promise<PricedCart> {
    const client = await this.pool.connect();
    try {
      return await this.getCartWithClient(client, scopedTenantId, scopedCartId);
    } finally {
      client.release();
    }
  }

  public async commitCart(
    scopedTenantId: TenantId,
    scopedCartId: CartId,
    providerReference: string,
  ): Promise<ModelledOrder> {
    return this.transaction(async (client) => {
      const headerResult = await client.query<CartHeaderRow>(cartHeaderQuery(true), [
        scopedTenantId,
        scopedCartId,
      ]);
      const header = headerResult.rows[0];

      if (!header) {
        throw new CommerceError("CART_NOT_FOUND", "Cart does not exist");
      }
      if (header.status === "COMMITTED") {
        return this.getOrderByCart(client, scopedTenantId, scopedCartId);
      }
      if (header.status === "COMMITTING") {
        throw new CommerceError(
          "CART_NOT_OPEN",
          "Cart is being processed by the trusted commit workflow",
        );
      }

      const lineResult = await client.query<CartLineRow>(
        `${cartLinesQuery()} FOR UPDATE OF i`,
        [scopedTenantId, scopedCartId],
      );
      if (lineResult.rowCount === 0) {
        throw new CommerceError("EMPTY_CART", "Cart has no products");
      }

      const lines = lineResult.rows.map(mapCartLine);
      for (const [index, line] of lines.entries()) {
        const available = lineResult.rows[index]?.available_quantity ?? 0;
        if (available < line.quantity) {
          throw new CommerceError(
            "OUT_OF_STOCK",
            `${line.sku} has ${String(available)} available; ${String(line.quantity)} requested`,
          );
        }
      }
      const total = calculateCartTotal(header.currency, lines);

      for (const line of lines) {
        const stockResult = await client.query(
          `UPDATE conduit.inventory
           SET available_quantity = available_quantity - $3,
               version = version + 1,
               updated_at = clock_timestamp()
           WHERE tenant_id = $1 AND product_id = $2
             AND available_quantity >= $3`,
          [scopedTenantId, line.productId, line.quantity],
        );
        if (stockResult.rowCount !== 1) {
          throw new CommerceError("OUT_OF_STOCK", `${line.sku} is out of stock`);
        }
      }

      const orderResult = await client.query<OrderRow>(
        `INSERT INTO conduit.orders (
           tenant_id, merchant_id, cart_id, status, provider_reference,
           currency, total_minor_units
         ) VALUES ($1, $2, $3, 'MODELLED', $4, $5, $6)
         RETURNING id, tenant_id, merchant_id, cart_id, provider_reference,
                   currency, total_minor_units`,
        [
          scopedTenantId,
          header.merchant_id,
          scopedCartId,
          providerReference,
          total.currency,
          total.minorUnits.toString(),
        ],
      );
      const order = requiredRow(orderResult.rows[0], "order insert");

      for (const line of lines) {
        await client.query(
          `INSERT INTO conduit.order_lines (
             order_id, product_id, sku, display_name, quantity, price_version,
             currency, unit_minor_units, line_minor_units
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            order.id,
            line.productId,
            line.sku,
            line.displayName,
            line.quantity,
            line.priceVersion,
            line.unitPrice.currency,
            line.unitPrice.minorUnits.toString(),
            line.lineTotal.minorUnits.toString(),
          ],
        );
      }

      await client.query(
        `UPDATE conduit.carts
         SET status = 'COMMITTED', committed_at = clock_timestamp()
         WHERE tenant_id = $1 AND id = $2`,
        [scopedTenantId, scopedCartId],
      );

      return mapOrder(order, lines);
    });
  }

  private async getProductWithClient(
    client: PoolClient,
    scopedTenantId: TenantId,
    scopedProductId: ProductId,
  ): Promise<CatalogProduct> {
    const result = await client.query<ProductRow>(productQuery("product"), [
      scopedTenantId,
      scopedProductId,
    ]);
    const row = result.rows[0];
    if (!row) {
      throw new CommerceError("PRODUCT_NOT_FOUND", "Product does not exist");
    }

    return mapProduct(row);
  }

  private async getCartWithClient(
    client: PoolClient,
    scopedTenantId: TenantId,
    scopedCartId: CartId,
  ): Promise<PricedCart> {
    const headerResult = await client.query<CartHeaderRow>(cartHeaderQuery(false), [
      scopedTenantId,
      scopedCartId,
    ]);
    const header = headerResult.rows[0];
    if (!header) {
      throw new CommerceError("CART_NOT_FOUND", "Cart does not exist");
    }

    if (header.status === "COMMITTED") {
      const order = await this.getOrderByCart(client, scopedTenantId, scopedCartId);
      return {
        id: scopedCartId,
        tenantId: scopedTenantId,
        merchantId: order.merchantId,
        status: "COMMITTED",
        lines: order.lines,
        total: order.total,
      };
    }

    const lineResult = await client.query<CartLineRow>(cartLinesQuery(), [
      scopedTenantId,
      scopedCartId,
    ]);
    const lines = lineResult.rows.map(mapCartLine);

    return {
      id: cartId(header.id),
      tenantId: tenantId(header.tenant_id),
      merchantId: merchantId(header.merchant_id),
      status: header.status,
      lines,
      total: calculateCartTotal(header.currency, lines),
    };
  }

  private async getOrderByCart(
    client: PoolClient,
    scopedTenantId: TenantId,
    scopedCartId: CartId,
  ): Promise<ModelledOrder> {
    const orderResult = await client.query<OrderRow>(
      `SELECT id, tenant_id, merchant_id, cart_id, provider_reference,
              currency, total_minor_units
       FROM conduit.orders
       WHERE tenant_id = $1 AND cart_id = $2`,
      [scopedTenantId, scopedCartId],
    );
    const order = orderResult.rows[0];
    if (!order) {
      throw new CommerceError("CART_NOT_OPEN", "Committed cart has no order");
    }
    const lineResult = await client.query<OrderLineRow>(
      `SELECT product_id, sku, display_name, quantity, price_version,
              currency, unit_minor_units, line_minor_units
       FROM conduit.order_lines
       WHERE order_id = $1
       ORDER BY sku`,
      [order.id],
    );
    const lines = lineResult.rows.map(mapOrderLine);

    return mapOrder(order, lines);
  }

  private async assertOpenCart(
    scopedTenantId: TenantId,
    scopedCartId: CartId,
  ): Promise<CartHeaderRow> {
    const result = await this.pool.query<CartHeaderRow>(cartHeaderQuery(false), [
      scopedTenantId,
      scopedCartId,
    ]);
    const cart = result.rows[0];
    if (!cart) {
      throw new CommerceError("CART_NOT_FOUND", "Cart does not exist");
    }
    if (cart.status !== "OPEN") {
      throw new CommerceError("CART_NOT_OPEN", "Cart is already committed");
    }

    return cart;
  }

  private async assertOpenCartAndProduct(
    scopedTenantId: TenantId,
    scopedCartId: CartId,
    scopedProductId: ProductId,
  ): Promise<void> {
    const cart = await this.assertOpenCart(scopedTenantId, scopedCartId);
    const product = await this.pool.query(
      `SELECT 1 FROM conduit.products
       WHERE tenant_id = $1 AND merchant_id = $2 AND id = $3 AND active = true`,
      [scopedTenantId, cart.merchant_id, scopedProductId],
    );
    if (product.rowCount === 0) {
      throw new CommerceError(
        "PRODUCT_NOT_FOUND",
        "Product does not exist for this merchant",
      );
    }
  }

  private async transaction<TResult>(
    operation: (client: PoolClient) => Promise<TResult>,
  ): Promise<TResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
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

function productQuery(scope: "merchant" | "product"): string {
  const field = scope === "merchant" ? "p.merchant_id" : "p.id";
  return `SELECT p.id, p.tenant_id, p.merchant_id, p.sku, p.display_name,
                 p.description, p.category, p.attributes,
                 pp.currency, pp.minor_units, pp.version AS price_version,
                 i.available_quantity
          FROM conduit.products p
          JOIN conduit.product_prices pp
            ON pp.tenant_id = p.tenant_id AND pp.product_id = p.id
           AND pp.valid_to IS NULL
          JOIN conduit.inventory i
            ON i.tenant_id = p.tenant_id AND i.product_id = p.id
          WHERE p.tenant_id = $1 AND ${field} = $2 AND p.active = true
          ORDER BY p.sku`;
}

function cartHeaderQuery(forUpdate: boolean): string {
  return `SELECT c.id, c.tenant_id, c.merchant_id, c.status, m.currency
          FROM conduit.carts c
          JOIN conduit.merchants m
            ON m.tenant_id = c.tenant_id AND m.id = c.merchant_id
          WHERE c.tenant_id = $1 AND c.id = $2${forUpdate ? " FOR UPDATE OF c" : ""}`;
}

function cartLinesQuery(): string {
  return `SELECT p.id AS product_id, p.sku, p.display_name, cl.quantity,
                 pp.currency, pp.minor_units, pp.version AS price_version,
                 i.available_quantity
          FROM conduit.cart_lines cl
          JOIN conduit.products p
            ON p.tenant_id = cl.tenant_id AND p.id = cl.product_id
          JOIN conduit.product_prices pp
            ON pp.tenant_id = p.tenant_id AND pp.product_id = p.id
           AND pp.valid_to IS NULL
          JOIN conduit.inventory i
            ON i.tenant_id = p.tenant_id AND i.product_id = p.id
          WHERE cl.tenant_id = $1 AND cl.cart_id = $2
          ORDER BY p.sku`;
}

function mapTenant(row: TenantRow): Tenant {
  return {
    id: tenantId(row.id),
    slug: row.slug,
    displayName: row.display_name,
  };
}

function mapMerchant(row: MerchantRow): Merchant {
  return {
    id: merchantId(row.id),
    tenantId: tenantId(row.tenant_id),
    slug: row.slug,
    displayName: row.display_name,
    currency: row.currency,
  };
}

function mapProduct(row: ProductRow): CatalogProduct {
  return {
    id: productId(row.id),
    tenantId: tenantId(row.tenant_id),
    merchantId: merchantId(row.merchant_id),
    sku: row.sku,
    displayName: row.display_name,
    description: row.description,
    category: row.category,
    attributes: row.attributes,
    price: Money.fromMinorUnits(row.currency, BigInt(row.minor_units)),
    priceVersion: row.price_version,
    availableQuantity: row.available_quantity,
  };
}

function mapCartLine(row: CartLineRow): PricedCartLine {
  const unitPrice = Money.fromMinorUnits(row.currency, BigInt(row.minor_units));
  return {
    productId: productId(row.product_id),
    sku: row.sku,
    displayName: row.display_name,
    quantity: row.quantity,
    unitPrice,
    priceVersion: row.price_version,
    lineTotal: calculateLineTotal(unitPrice, row.quantity),
  };
}

function mapOrderLine(row: OrderLineRow): PricedCartLine {
  return {
    productId: productId(row.product_id),
    sku: row.sku,
    displayName: row.display_name,
    quantity: row.quantity,
    unitPrice: Money.fromMinorUnits(row.currency, BigInt(row.unit_minor_units)),
    priceVersion: row.price_version,
    lineTotal: Money.fromMinorUnits(row.currency, BigInt(row.line_minor_units)),
  };
}

function mapOrder(row: OrderRow, lines: readonly PricedCartLine[]): ModelledOrder {
  return {
    id: orderId(row.id),
    tenantId: tenantId(row.tenant_id),
    merchantId: merchantId(row.merchant_id),
    cartId: cartId(row.cart_id),
    status: "MODELLED",
    providerReference: row.provider_reference,
    lines,
    total: Money.fromMinorUnits(row.currency, BigInt(row.total_minor_units)),
  };
}

function requiredRow<TRow>(row: TRow | undefined, operation: string): TRow {
  if (!row) {
    throw new Error(`PostgreSQL returned no row for ${operation}`);
  }
  return row;
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === "string" ? code : undefined;
}
