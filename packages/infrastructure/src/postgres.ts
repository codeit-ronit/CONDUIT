import { Pool } from "pg";

const LOCAL_DATABASE_URL =
  "postgresql://conduit:conduit_local_only@127.0.0.1:54329/conduit";

/**
 * Production must set DATABASE_URL explicitly. The fallback exists only so the
 * committed local Docker environment works immediately after cloning.
 */
export function databaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.NODE_ENV === "production" && !environment.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in production");
  }

  return environment.DATABASE_URL ?? LOCAL_DATABASE_URL;
}

export function createDatabasePool(environment: NodeJS.ProcessEnv = process.env): Pool {
  return new Pool({
    connectionString: databaseUrl(environment),
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: "conduit",
  });
}
