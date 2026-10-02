# Phase 0 Learning Note: Docker, PostgreSQL, and Migrations

## What did we build?

- A Docker-compatible runtime on macOS using Docker CLI, Docker Compose, and Colima.
- A pinned PostgreSQL 18.6 container in `compose.yaml`.
- A persistent named volume for database files.
- A health check that prevents migrations from racing database startup.
- A versioned migration system using `node-pg-migrate`.
- A PostgreSQL connection-pool adapter in `@conduit/infrastructure`.
- Integration tests against a real PostgreSQL server, not an in-memory substitute.

## What does Docker do here?

Docker gives every developer and CI run the same database version and configuration. The
PostgreSQL server runs inside a small Linux virtual machine managed by Colima on this
Mac. Project commands still use ordinary `docker compose`, so another developer may use
Docker Desktop without changing the repository.

```text
pnpm db:setup
      │
      ▼
Docker Compose reads compose.yaml + local .env
      │
      ▼
PostgreSQL 18.6 container
      │
      ├── database files → named Docker volume
      └── port 5432 → host 127.0.0.1:54329
```

The host port binds only to `127.0.0.1`, so another computer cannot connect to this
development database through the network.

## Why pin `postgres:18.6-trixie`?

`latest` changes over time. A build that works today could silently run a different
major version tomorrow. We pin the current stable patch and Debian variant so local and
CI evidence refer to a known server. PostgreSQL 19 was still beta when this decision was
made, so it is deliberately excluded.

## Why use a named volume?

Containers are replaceable processes. Removing a container should not erase normal
development data. The named volume `conduit_postgres_data` stores the database files
outside the container lifecycle.

`docker compose down` removes containers and the network but preserves the volume.
Deleting the volume is intentionally not part of any normal project command because it
is a destructive reset.

## What is a migration?

A migration is an ordered, version-controlled database change. The first migration:

1. creates a dedicated `conduit` schema;
2. enables PostgreSQL's `pgcrypto` extension for secure database-side UUID/randomness
   primitives needed later;
3. is recorded in `public.schema_migrations`.

The migration runner uses PostgreSQL locking and a transaction. If a migration fails,
its partial changes roll back. Running migrations twice is safe: the second run finds
nothing pending instead of repeating the change.

Never edit an applied migration. Add a new migration that moves the schema forward.
Editing history makes two databases with the same recorded migration name structurally
different.

## Why a connection pool?

Opening a fresh database connection for every request is expensive. A pool keeps a small
bounded set of reusable connections. V1 currently allows at most ten connections per
process and uses connection/idle timeouts so a broken database does not cause an
unbounded wait.

The pool belongs in `infrastructure`, not `domain`, because a database is an I/O detail.
The domain remains testable without PostgreSQL.

## What does the rollback test prove?

The integration test begins a real transaction, creates a probe table, rolls back, and
then asks PostgreSQL whether the table exists. It does not. This is the mechanism later
used to ensure a failed commit gate cannot leave half a stock reservation or half a
money reservation behind.

It does not yet prove the complete commerce transaction, because those tables and use
cases do not exist.

## Development commands

```text
pnpm db:up          Start PostgreSQL and wait until healthy
pnpm db:migrate     Apply pending migrations
pnpm db:check       Migrate twice and run live integration tests
pnpm db:setup       Start, migrate, and test
pnpm db:shell       Open psql inside the PostgreSQL container
pnpm db:logs        Follow PostgreSQL logs
pnpm db:down        Stop containers; preserve database data
```

## Credentials and production

`.env.example` contains intentionally public local-development credentials. The actual
`.env` file is ignored by Git. Production must provide `DATABASE_URL` through a proper
secret manager; the infrastructure code refuses to use the local fallback when
`NODE_ENV=production`.

This Compose setup is a development and CI tool. It is not a production database
deployment, backup strategy, high-availability design, or secret-management system.

## Evidence and limits

Verified on 2026-10-02:

- Docker client 29.8.2 reached a Docker 29.5.2 engine on Colima.
- Docker successfully ran the ARM64 `hello-world` image.
- PostgreSQL reported server version number `180006` (18.6).
- Re-running the migration performed no duplicate operation.
- The down migration removed the foundation and the up migration rebuilt it cleanly.
- Three live integration tests passed.

Not yet built:

- Business tables, tenant row-level security, repositories, backup/restore, production
  TLS, credentials rotation, monitoring, or high availability.
