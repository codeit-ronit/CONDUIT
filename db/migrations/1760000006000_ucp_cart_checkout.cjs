exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE conduit.ucp_cart_bindings (
      tenant_id uuid NOT NULL,
      merchant_id uuid NOT NULL,
      cart_id uuid PRIMARY KEY,
      principal_id text NOT NULL CHECK (length(principal_id) BETWEEN 1 AND 200),
      agent_profile text NOT NULL CHECK (agent_profile LIKE 'https://%'),
      idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
      canceled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY (tenant_id, merchant_id, cart_id)
        REFERENCES conduit.carts(tenant_id, merchant_id, id) ON DELETE CASCADE,
      UNIQUE (tenant_id, principal_id, idempotency_key)
    );

    CREATE TABLE conduit.ucp_checkout_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      merchant_id uuid NOT NULL,
      cart_id uuid NOT NULL UNIQUE,
      grant_id uuid NOT NULL,
      principal_id text NOT NULL CHECK (length(principal_id) BETWEEN 1 AND 200),
      agent_profile text NOT NULL CHECK (agent_profile LIKE 'https://%'),
      status text NOT NULL DEFAULT 'REQUIRES_ESCALATION'
        CHECK (status IN ('REQUIRES_ESCALATION', 'COMPLETED', 'CANCELED')),
      review_token_digest text NOT NULL CHECK (length(review_token_digest) = 64),
      operation_key text NOT NULL UNIQUE,
      operation_id uuid,
      order_id uuid,
      expires_at timestamptz NOT NULL,
      reviewed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY (tenant_id, merchant_id, cart_id)
        REFERENCES conduit.carts(tenant_id, merchant_id, id),
      FOREIGN KEY (tenant_id, grant_id)
        REFERENCES conduit.authorization_grants(tenant_id, id),
      FOREIGN KEY (tenant_id, operation_id)
        REFERENCES conduit.purchase_operations(tenant_id, id),
      FOREIGN KEY (tenant_id, order_id)
        REFERENCES conduit.orders(tenant_id, id),
      CHECK (expires_at > created_at),
      CHECK (
        (status = 'COMPLETED' AND reviewed_at IS NOT NULL
          AND operation_id IS NOT NULL AND order_id IS NOT NULL)
        OR status <> 'COMPLETED'
      )
    );

    CREATE TABLE conduit.ucp_idempotency_records (
      tenant_id uuid NOT NULL,
      principal_id text NOT NULL,
      operation text NOT NULL,
      idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
      request_digest text NOT NULL CHECK (length(request_digest) = 64),
      status_code integer NOT NULL CHECK (status_code BETWEEN 100 AND 599),
      response_body jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (tenant_id, principal_id, operation, idempotency_key)
    );

    CREATE INDEX ucp_idempotency_expiry
      ON conduit.ucp_idempotency_records(created_at);
    CREATE INDEX ucp_checkout_principal
      ON conduit.ucp_checkout_sessions(tenant_id, principal_id, created_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE conduit.ucp_idempotency_records;
    DROP TABLE conduit.ucp_checkout_sessions;
    DROP TABLE conduit.ucp_cart_bindings;
  `);
};
