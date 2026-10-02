exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE conduit.enforcement_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES conduit.tenants(id),
      trust_state text NOT NULL DEFAULT 'CLEAN'
        CHECK (trust_state IN ('CLEAN', 'QUARANTINED')),
      quarantine_nonce uuid NOT NULL,
      policy_version text NOT NULL CHECK (policy_version = 'boundary-v1'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (tenant_id, id)
    );

    CREATE TABLE conduit.tool_approvals (
      tenant_id uuid NOT NULL REFERENCES conduit.tenants(id),
      provider_id text NOT NULL CHECK (length(provider_id) BETWEEN 1 AND 120),
      tool_name text NOT NULL CHECK (tool_name ~ '^[a-z][a-z0-9._-]{1,119}$'),
      classification text NOT NULL CHECK (
        classification IN ('READ_ONLY', 'REVERSIBLE_WRITE', 'BINDING_WRITE', 'EXTERNAL_EFFECT')
      ),
      schema_hash character(64) NOT NULL CHECK (schema_hash ~ '^[0-9a-f]{64}$'),
      schema_snapshot jsonb NOT NULL CHECK (jsonb_typeof(schema_snapshot) = 'object'),
      enabled boolean NOT NULL DEFAULT true,
      approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (tenant_id, provider_id, tool_name)
    );

    CREATE TABLE conduit.audit_heads (
      tenant_id uuid PRIMARY KEY REFERENCES conduit.tenants(id),
      last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
      last_hash character(64) NOT NULL DEFAULT repeat('0', 64)
        CHECK (last_hash ~ '^[0-9a-f]{64}$'),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );

    CREATE TABLE conduit.audit_entries (
      tenant_id uuid NOT NULL,
      sequence bigint NOT NULL CHECK (sequence > 0),
      run_id uuid NOT NULL,
      call_id uuid NOT NULL,
      phase text NOT NULL CHECK (phase IN ('DECISION', 'OUTCOME')),
      canonical_payload text NOT NULL,
      previous_hash character(64) NOT NULL CHECK (previous_hash ~ '^[0-9a-f]{64}$'),
      entry_hash character(64) NOT NULL CHECK (entry_hash ~ '^[0-9a-f]{64}$'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (tenant_id, sequence),
      FOREIGN KEY (tenant_id, run_id)
        REFERENCES conduit.enforcement_runs(tenant_id, id),
      UNIQUE (tenant_id, call_id, phase)
    );

    CREATE INDEX audit_entries_tenant_run_sequence
      ON conduit.audit_entries(tenant_id, run_id, sequence);

    CREATE FUNCTION conduit.reject_audit_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'audit entries are append-only';
    END;
    $$;

    CREATE TRIGGER audit_entries_append_only
      BEFORE UPDATE OR DELETE ON conduit.audit_entries
      FOR EACH ROW EXECUTE FUNCTION conduit.reject_audit_mutation();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER audit_entries_append_only ON conduit.audit_entries;
    DROP FUNCTION conduit.reject_audit_mutation;
    DROP TABLE conduit.audit_entries;
    DROP TABLE conduit.audit_heads;
    DROP TABLE conduit.tool_approvals;
    DROP TABLE conduit.enforcement_runs;
  `);
};
