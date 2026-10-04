exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE conduit.catalog_imports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      merchant_id uuid NOT NULL,
      source_type text NOT NULL CHECK (source_type IN ('CSV', 'XLSX', 'STOREFRONT')),
      source_name text NOT NULL CHECK (length(source_name) BETWEEN 1 AND 500),
      source_digest text NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
      mapping jsonb NOT NULL CHECK (jsonb_typeof(mapping) = 'object'),
      confirmation_fingerprint text NOT NULL CHECK (confirmation_fingerprint ~ '^[a-f0-9]{64}$'),
      status text NOT NULL DEFAULT 'PREVIEWED' CHECK (status IN ('PREVIEWED', 'CONFIRMED')),
      imported_count integer NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
      skipped_count integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      confirmed_at timestamptz,
      FOREIGN KEY (tenant_id, merchant_id)
        REFERENCES conduit.merchants(tenant_id, id),
      UNIQUE (tenant_id, id),
      CHECK (
        (status = 'PREVIEWED' AND confirmed_at IS NULL)
        OR (status = 'CONFIRMED' AND confirmed_at IS NOT NULL)
      )
    );

    CREATE TABLE conduit.catalog_import_rows (
      import_id uuid NOT NULL REFERENCES conduit.catalog_imports(id) ON DELETE CASCADE,
      row_number integer NOT NULL CHECK (row_number > 0),
      disposition text NOT NULL CHECK (disposition IN ('READY', 'SKIPPED', 'IMPORTED')),
      reason_code text CHECK (reason_code IN (
        'MISSING_REQUIRED_VALUE', 'INVALID_SKU', 'INVALID_PRICE', 'CURRENCY_MISMATCH',
        'INVALID_STOCK', 'DUPLICATE_IN_FILE', 'EXISTING_SKU'
      )),
      explanation text,
      raw_data jsonb NOT NULL CHECK (jsonb_typeof(raw_data) = 'object'),
      normalized_data jsonb CHECK (
        normalized_data IS NULL OR jsonb_typeof(normalized_data) = 'object'
      ),
      product_id uuid REFERENCES conduit.products(id),
      PRIMARY KEY (import_id, row_number),
      CHECK (
        (disposition = 'READY' AND reason_code IS NULL AND normalized_data IS NOT NULL AND product_id IS NULL)
        OR (disposition = 'SKIPPED' AND reason_code IS NOT NULL AND product_id IS NULL)
        OR (disposition = 'IMPORTED' AND reason_code IS NULL AND normalized_data IS NOT NULL AND product_id IS NOT NULL)
      )
    );

    CREATE TABLE conduit.product_provenance (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id uuid NOT NULL,
      product_id uuid NOT NULL,
      import_id uuid NOT NULL REFERENCES conduit.catalog_imports(id),
      field_name text NOT NULL CHECK (length(field_name) BETWEEN 1 AND 100),
      source_type text NOT NULL CHECK (source_type IN ('CSV', 'XLSX', 'STOREFRONT')),
      source_ref text NOT NULL,
      source_digest text NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
      source_path text NOT NULL,
      observed_value jsonb NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY (tenant_id, product_id)
        REFERENCES conduit.products(tenant_id, id),
      UNIQUE (product_id, import_id, field_name)
    );

    CREATE TABLE conduit.attribute_enrichment_proposals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      product_id uuid NOT NULL,
      attribute_name text NOT NULL CHECK (length(attribute_name) BETWEEN 1 AND 80),
      proposed_value jsonb NOT NULL,
      evidence text NOT NULL CHECK (length(evidence) BETWEEN 1 AND 2000),
      model_id text NOT NULL,
      status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
      reviewed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY (tenant_id, product_id)
        REFERENCES conduit.products(tenant_id, id),
      CHECK (
        (status = 'PENDING' AND reviewed_at IS NULL)
        OR (status IN ('ACCEPTED', 'REJECTED') AND reviewed_at IS NOT NULL)
      )
    );

    CREATE INDEX catalog_imports_merchant_created
      ON conduit.catalog_imports(tenant_id, merchant_id, created_at DESC);
    CREATE INDEX product_provenance_product
      ON conduit.product_provenance(tenant_id, product_id, field_name);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE conduit.attribute_enrichment_proposals;
    DROP TABLE conduit.product_provenance;
    DROP TABLE conduit.catalog_import_rows;
    DROP TABLE conduit.catalog_imports;
  `);
};
