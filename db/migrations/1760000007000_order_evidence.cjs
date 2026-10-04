exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE conduit.order_evidence_events (
      sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id uuid NOT NULL,
      order_id uuid NOT NULL,
      operation_id uuid NOT NULL,
      event_key text NOT NULL CHECK (length(event_key) BETWEEN 8 AND 240),
      event_type text NOT NULL CHECK (event_type ~ '^[A-Z][A-Z0-9_]{2,79}$'),
      source text NOT NULL CHECK (source ~ '^[A-Z][A-Z0-9_]{2,79}$'),
      payload jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(payload) = 'object'),
      occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY (tenant_id, order_id) REFERENCES conduit.orders(tenant_id, id),
      FOREIGN KEY (tenant_id, operation_id)
        REFERENCES conduit.purchase_operations(tenant_id, id),
      UNIQUE (tenant_id, event_key)
    );

    CREATE INDEX order_evidence_order_sequence
      ON conduit.order_evidence_events(tenant_id, order_id, sequence);

    CREATE FUNCTION conduit.reject_order_evidence_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'order evidence events are append-only';
    END;
    $$;

    CREATE TRIGGER order_evidence_events_append_only
      BEFORE UPDATE OR DELETE ON conduit.order_evidence_events
      FOR EACH ROW EXECUTE FUNCTION conduit.reject_order_evidence_mutation();

    INSERT INTO conduit.order_evidence_events (
      tenant_id, order_id, operation_id, event_key, event_type, source,
      payload, occurred_at
    )
    SELECT o.tenant_id, o.id, p.id, p.id::text || ':order-prepared',
           'ORDER_PREPARED', 'MIGRATION_BACKFILL',
           jsonb_build_object(
             'orderStatus', o.status,
             'currency', o.currency,
             'totalMinorUnits', o.total_minor_units::text
           ),
           o.created_at
    FROM conduit.orders o
    JOIN conduit.purchase_operations p ON p.id = o.operation_id;

    INSERT INTO conduit.order_evidence_events (
      tenant_id, order_id, operation_id, event_key, event_type, source,
      payload, occurred_at
    )
    SELECT p.tenant_id, o.id, p.id, p.id::text || ':payment-final-backfill',
           CASE p.status
             WHEN 'CONFIRMED' THEN 'PAYMENT_CONFIRMED'
             WHEN 'FAILED' THEN 'PAYMENT_DECLINED'
             WHEN 'PAYMENT_UNKNOWN' THEN 'PAYMENT_UNKNOWN'
           END,
           'MIGRATION_BACKFILL',
           jsonb_build_object(
             'providerReference', p.provider_reference,
             'operationStatus', p.status
           ),
           p.updated_at
    FROM conduit.purchase_operations p
    JOIN conduit.orders o ON o.operation_id = p.id
    WHERE p.status IN ('CONFIRMED', 'FAILED', 'PAYMENT_UNKNOWN');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER order_evidence_events_append_only
      ON conduit.order_evidence_events;
    DROP FUNCTION conduit.reject_order_evidence_mutation;
    DROP TABLE conduit.order_evidence_events;
  `);
};
