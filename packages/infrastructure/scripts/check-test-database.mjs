import { spawnSync } from "node:child_process";

import pg from "pg";

const source = new URL(
  process.env.DATABASE_URL ??
    "postgresql://conduit:conduit_local_only@127.0.0.1:54329/conduit",
);

if (!new Set(["127.0.0.1", "localhost", "postgres"]).has(source.hostname)) {
  throw new Error("Integration tests may only reset a local or CI PostgreSQL host");
}
if (process.env.NODE_ENV === "production") {
  throw new Error("Integration tests are disabled in production");
}

const sourceName = source.pathname.slice(1);
if (!/^[a-z][a-z0-9_]{0,40}$/u.test(sourceName)) {
  throw new Error("Unsafe source database name");
}
const testName = `${sourceName}_test`;
const admin = new URL(source);
admin.pathname = "/postgres";
const test = new URL(source);
test.pathname = `/${testName}`;

const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
try {
  const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
    testName,
  ]);
  if (existing.rowCount === 0) {
    await client.query(`CREATE DATABASE "${testName}"`);
    process.stdout.write(`Created isolated integration database ${testName}.\n`);
  }
} finally {
  await client.end();
}

const environment = { ...process.env, DATABASE_URL: test.toString() };
run("pnpm", ["db:migrate"], environment);
run("pnpm", ["db:migrate"], environment);
run("pnpm", ["--dir", "../..", "test:integration:raw"], environment);

function run(command, arguments_, environment) {
  const result = spawnSync(command, arguments_, {
    env: environment,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
