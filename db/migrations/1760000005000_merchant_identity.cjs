exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE conduit.merchant_users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL UNIQUE CHECK (
        email = lower(email)
        AND length(email) BETWEEN 3 AND 320
        AND email LIKE '%@%'
      ),
      display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
      password_salt text NOT NULL CHECK (password_salt ~ '^[a-f0-9]{32}$'),
      password_digest text NOT NULL CHECK (password_digest ~ '^[a-f0-9]{64}$'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );

    CREATE TABLE conduit.merchant_memberships (
      user_id uuid PRIMARY KEY REFERENCES conduit.merchant_users(id) ON DELETE CASCADE,
      tenant_id uuid NOT NULL,
      merchant_id uuid NOT NULL,
      role text NOT NULL CHECK (role IN ('OWNER', 'OPERATOR', 'VIEWER')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY (tenant_id, merchant_id)
        REFERENCES conduit.merchants(tenant_id, id)
    );

    CREATE TABLE conduit.browser_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES conduit.merchant_users(id) ON DELETE CASCADE,
      token_digest text NOT NULL UNIQUE CHECK (token_digest ~ '^[a-f0-9]{64}$'),
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK (expires_at > created_at),
      CHECK (revoked_at IS NULL OR revoked_at >= created_at)
    );

    CREATE INDEX browser_sessions_active_user
      ON conduit.browser_sessions(user_id, expires_at)
      WHERE revoked_at IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE conduit.browser_sessions;
    DROP TABLE conduit.merchant_memberships;
    DROP TABLE conduit.merchant_users;
  `);
};
