import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabasePool } from "../src/index.js";

interface SettingRow {
  readonly setting: string;
}

interface ExistsRow {
  readonly exists: boolean;
}

interface CountRow {
  readonly count: string;
}

describe("PostgreSQL foundation", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createDatabasePool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("runs the pinned PostgreSQL major version", async () => {
    const result = await pool.query<SettingRow>(
      "SELECT current_setting('server_version_num') AS setting",
    );

    expect(result.rows[0]?.setting).toBe("180006");
  });

  it("applies every database migration exactly once", async () => {
    const schema = await pool.query<ExistsRow>(
      "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'conduit') AS exists",
    );
    const extension = await pool.query<ExistsRow>(
      "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') AS exists",
    );
    const migrations = await pool.query<CountRow>(
      "SELECT COUNT(*)::text AS count FROM schema_migrations",
    );

    expect(schema.rows[0]?.exists).toBe(true);
    expect(extension.rows[0]?.exists).toBe(true);
    expect(migrations.rows[0]?.count).toBe("7");
  });

  it("rolls back an incomplete transaction without leaving state", async () => {
    const client = await pool.connect();

    try {
      await exerciseRollback(client);
    } finally {
      client.release();
    }

    const result = await pool.query<{ readonly table_name: string | null }>(
      "SELECT to_regclass('conduit.rollback_probe')::text AS table_name",
    );

    expect(result.rows[0]?.table_name).toBeNull();
  });
});

async function exerciseRollback(client: PoolClient): Promise<void> {
  await client.query("BEGIN");

  try {
    await client.query("CREATE TABLE conduit.rollback_probe (id bigint PRIMARY KEY)");
  } finally {
    await client.query("ROLLBACK");
  }
}
