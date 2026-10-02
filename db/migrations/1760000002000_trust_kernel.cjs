exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE conduit.carts DROP CONSTRAINT carts_status_check;
    ALTER TABLE conduit.carts ADD CONSTRAINT carts_status_check
      CHECK (status IN ('OPEN', 'COMMITTING', 'COMMITTED'));
    ALTER TABLE conduit.carts DROP CONSTRAINT carts_check;
    ALTER TABLE conduit.carts ADD CONSTRAINT carts_lifecycle_check CHECK (
      (status IN ('OPEN', 'COMMITTING') AND committed_at IS NULL)
      OR (status = 'COMMITTED' AND committed_at IS NOT NULL)
    );

    ALTER TABLE conduit.orders DROP CONSTRAINT orders_status_check;
    ALTER TABLE conduit.orders ADD CONSTRAINT orders_status_check
      CHECK (status IN ('PENDING', 'MODELLED', 'FAILED'));

    CREATE TABLE conduit.buyers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES conduit.tenants(id),
      display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (tenant_id, id)
    );

    CREATE TABLE conduit.authorization_grants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      buyer_id uuid NOT NULL,
      merchant_id uuid NOT NULL,
      currency character(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      maximum_minor_units bigint NOT NULL CHECK (maximum_minor_units >= 0),
      allowed_categories text[] NOT NULL DEFAULT '{}',
      allowed_skus text[] NOT NULL DEFAULT '{}',
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      policy_version text NOT NULL CHECK (policy_version = 'trust-v1'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY (tenant_id, buyer_id) REFERENCES conduit.buyers(tenant_id, id),
      FOREIGN KEY (tenant_id, merchant_id) REFERENCES conduit.merchants(tenant_id, id),
      UNIQUE (tenant_id, id)
    );

    CREATE TABLE conduit.purchase_operations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      operation_key text NOT NULL CHECK (length(operation_key) BETWEEN 8 AND 120),
      cart_id uuid NOT NULL,
      grant_id uuid NOT NULL,
      status text NOT NULL CHECK (
        status IN ('PENDING_PROVIDER', 'CONFIRMED', 'PAYMENT_UNKNOWN', 'FAILED')
      ),
      decision_reason text NOT NULL,
      currency character(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      total_minor_units bigint NOT NULL CHECK (total_minor_units >= 0),
      provider_reference text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY (tenant_id, cart_id) REFERENCES conduit.carts(tenant_id, id),
      FOREIGN KEY (tenant_id, grant_id) REFERENCES conduit.authorization_grants(tenant_id, id),
      UNIQUE (tenant_id, operation_key),
      UNIQUE (tenant_id, id)
    );

    ALTER TABLE conduit.orders ADD COLUMN operation_id uuid;
    ALTER TABLE conduit.orders ADD CONSTRAINT orders_operation_fk
      FOREIGN KEY (tenant_id, operation_id)
      REFERENCES conduit.purchase_operations(tenant_id, id);
    CREATE UNIQUE INDEX orders_operation_unique
      ON conduit.orders(operation_id) WHERE operation_id IS NOT NULL;

    CREATE TABLE conduit.inventory_reservations (
      operation_id uuid NOT NULL REFERENCES conduit.purchase_operations(id),
      tenant_id uuid NOT NULL,
      product_id uuid NOT NULL,
      quantity integer NOT NULL CHECK (quantity > 0),
      status text NOT NULL CHECK (status IN ('RESERVED', 'CONFIRMED', 'RELEASED')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (operation_id, product_id),
      FOREIGN KEY (tenant_id, product_id) REFERENCES conduit.products(tenant_id, id)
    );

    CREATE TABLE conduit.drawdown_entries (
      sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id uuid NOT NULL,
      grant_id uuid NOT NULL,
      operation_id uuid NOT NULL,
      entry_type text NOT NULL CHECK (
        entry_type IN ('RESERVE', 'CONFIRM', 'RELEASE', 'REVERSE')
      ),
      currency character(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      minor_units bigint NOT NULL CHECK (minor_units >= 0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY (tenant_id, grant_id)
        REFERENCES conduit.authorization_grants(tenant_id, id),
      FOREIGN KEY (tenant_id, operation_id)
        REFERENCES conduit.purchase_operations(tenant_id, id),
      UNIQUE (operation_id, entry_type)
    );

    CREATE TABLE conduit.provider_outbox (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      operation_id uuid NOT NULL,
      event_type text NOT NULL CHECK (event_type = 'AUTHORIZE_PAYMENT'),
      status text NOT NULL CHECK (
        status IN ('PENDING', 'PROCESSING', 'DELIVERED', 'UNKNOWN')
      ),
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      locked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY (tenant_id, operation_id)
        REFERENCES conduit.purchase_operations(tenant_id, id),
      UNIQUE (operation_id, event_type)
    );

    CREATE INDEX grants_tenant_buyer_active
      ON conduit.authorization_grants(tenant_id, buyer_id, expires_at)
      WHERE revoked_at IS NULL;
    CREATE INDEX operations_tenant_status
      ON conduit.purchase_operations(tenant_id, status);
    CREATE INDEX provider_outbox_pending
      ON conduit.provider_outbox(status, created_at)
      WHERE status IN ('PENDING', 'UNKNOWN');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE conduit.provider_outbox;
    DROP TABLE conduit.drawdown_entries;
    DROP TABLE conduit.inventory_reservations;
    DROP INDEX conduit.orders_operation_unique;
    ALTER TABLE conduit.orders DROP CONSTRAINT orders_operation_fk;
    ALTER TABLE conduit.orders DROP COLUMN operation_id;
    DROP TABLE conduit.purchase_operations;
    DROP TABLE conduit.authorization_grants;
    DROP TABLE conduit.buyers;

    ALTER TABLE conduit.orders DROP CONSTRAINT orders_status_check;
    ALTER TABLE conduit.orders ADD CONSTRAINT orders_status_check CHECK (status = 'MODELLED');
    ALTER TABLE conduit.carts DROP CONSTRAINT carts_lifecycle_check;
    ALTER TABLE conduit.carts DROP CONSTRAINT carts_status_check;
    ALTER TABLE conduit.carts ADD CONSTRAINT carts_status_check
      CHECK (status IN ('OPEN', 'COMMITTED'));
    ALTER TABLE conduit.carts ADD CONSTRAINT carts_check CHECK (
      (status = 'OPEN' AND committed_at IS NULL)
      OR (status = 'COMMITTED' AND committed_at IS NOT NULL)
    );
  `);
};
