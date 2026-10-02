exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE conduit.tenants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
      display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );

    CREATE TABLE conduit.merchants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES conduit.tenants(id),
      slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
      display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
      currency character(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (tenant_id, slug),
      UNIQUE (tenant_id, id)
    );

    CREATE TABLE conduit.products (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      merchant_id uuid NOT NULL,
      sku text NOT NULL CHECK (sku ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
      display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
      description text NOT NULL CHECK (length(description) <= 5000),
      category text NOT NULL CHECK (length(category) BETWEEN 1 AND 100),
      attributes jsonb NOT NULL CHECK (jsonb_typeof(attributes) = 'object'),
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY (tenant_id, merchant_id)
        REFERENCES conduit.merchants(tenant_id, id),
      UNIQUE (merchant_id, sku),
      UNIQUE (tenant_id, merchant_id, id),
      UNIQUE (tenant_id, id)
    );

    CREATE TABLE conduit.product_prices (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id uuid NOT NULL,
      product_id uuid NOT NULL,
      version integer NOT NULL CHECK (version > 0),
      currency character(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      minor_units bigint NOT NULL CHECK (minor_units >= 0),
      valid_from timestamptz NOT NULL DEFAULT clock_timestamp(),
      valid_to timestamptz,
      FOREIGN KEY (tenant_id, product_id)
        REFERENCES conduit.products(tenant_id, id),
      UNIQUE (product_id, version),
      CHECK (valid_to IS NULL OR valid_to > valid_from)
    );

    CREATE UNIQUE INDEX one_current_price_per_product
      ON conduit.product_prices(product_id)
      WHERE valid_to IS NULL;

    CREATE TABLE conduit.inventory (
      tenant_id uuid NOT NULL,
      product_id uuid NOT NULL,
      available_quantity integer NOT NULL CHECK (available_quantity >= 0),
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (product_id),
      FOREIGN KEY (tenant_id, product_id)
        REFERENCES conduit.products(tenant_id, id),
      UNIQUE (tenant_id, product_id)
    );

    CREATE TABLE conduit.carts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      merchant_id uuid NOT NULL,
      status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'COMMITTED')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      committed_at timestamptz,
      FOREIGN KEY (tenant_id, merchant_id)
        REFERENCES conduit.merchants(tenant_id, id),
      UNIQUE (tenant_id, merchant_id, id),
      UNIQUE (tenant_id, id),
      CHECK (
        (status = 'OPEN' AND committed_at IS NULL)
        OR (status = 'COMMITTED' AND committed_at IS NOT NULL)
      )
    );

    CREATE TABLE conduit.cart_lines (
      tenant_id uuid NOT NULL,
      merchant_id uuid NOT NULL,
      cart_id uuid NOT NULL,
      product_id uuid NOT NULL,
      quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 999),
      added_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (cart_id, product_id),
      FOREIGN KEY (tenant_id, merchant_id, cart_id)
        REFERENCES conduit.carts(tenant_id, merchant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, merchant_id, product_id)
        REFERENCES conduit.products(tenant_id, merchant_id, id)
    );

    CREATE TABLE conduit.orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      merchant_id uuid NOT NULL,
      cart_id uuid NOT NULL,
      status text NOT NULL CHECK (status = 'MODELLED'),
      provider_reference text NOT NULL UNIQUE,
      currency character(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      total_minor_units bigint NOT NULL CHECK (total_minor_units >= 0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY (tenant_id, merchant_id, cart_id)
        REFERENCES conduit.carts(tenant_id, merchant_id, id),
      UNIQUE (cart_id),
      UNIQUE (tenant_id, id)
    );

    CREATE TABLE conduit.order_lines (
      order_id uuid NOT NULL REFERENCES conduit.orders(id) ON DELETE CASCADE,
      product_id uuid NOT NULL,
      sku text NOT NULL,
      display_name text NOT NULL,
      quantity integer NOT NULL CHECK (quantity > 0),
      price_version integer NOT NULL CHECK (price_version > 0),
      currency character(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      unit_minor_units bigint NOT NULL CHECK (unit_minor_units >= 0),
      line_minor_units bigint NOT NULL CHECK (line_minor_units >= 0),
      PRIMARY KEY (order_id, product_id)
    );

    CREATE INDEX products_tenant_merchant_category
      ON conduit.products(tenant_id, merchant_id, category)
      WHERE active = true;

    CREATE INDEX carts_tenant_merchant_status
      ON conduit.carts(tenant_id, merchant_id, status);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE conduit.order_lines;
    DROP TABLE conduit.orders;
    DROP TABLE conduit.cart_lines;
    DROP TABLE conduit.carts;
    DROP TABLE conduit.inventory;
    DROP TABLE conduit.product_prices;
    DROP TABLE conduit.products;
    DROP TABLE conduit.merchants;
    DROP TABLE conduit.tenants;
  `);
};
