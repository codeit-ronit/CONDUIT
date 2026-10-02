# Development Environment

**Checked:** 2026-10-02

| Tool           | Detected                         | Project status                               |
| -------------- | -------------------------------- | -------------------------------------------- |
| macOS          | Darwin 25.6.0 arm64              | Supported development host                   |
| Node.js        | 22.21.1                          | Ready; satisfies `>=22.12.0`                 |
| pnpm           | 10.25.0                          | Ready and pinned in `packageManager`         |
| npm            | 10.9.4                           | Available for registry inspection            |
| Git            | 2.52.0                           | Ready                                        |
| Docker CLI     | 29.8.2                           | Ready                                        |
| Docker engine  | 29.5.2 on Colima 0.10.3          | Ready through macOS Virtualization Framework |
| Docker Compose | 5.5.1                            | Ready as a standard Docker CLI plugin        |
| PostgreSQL     | 18.6 (`postgres:18.6-trixie`)    | Healthy, migrated, and integration-tested    |
| `psql`         | 18.6 inside PostgreSQL container | Available through `pnpm db:shell`            |

## Toolchain selection

On 2026-10-02, the npm registry reported TypeScript 7.0.2 as latest, but
TypeScript-ESLint 8.71.0 declared support for TypeScript `<6.1.0`. We therefore pinned
TypeScript 6.0.3. This avoids an unsupported combination while keeping the decision
visible and reproducible.

## Docker installation note

Docker Desktop 4.93.0 was attempted first, but macOS could not mount its DMG and
returned `Resource busy`. Docker CLI, Docker Compose, and Colima were installed through
Homebrew instead. The runtime passed Docker's `hello-world` test. This is compatible
with the repository's standard Compose file; Docker Desktop remains an optional
alternative for other developers.

## Non-blocking shell warning

Every login shell currently reports a missing Flutter path from `~/.zshenv`. CONDUIT
does not use Flutter, so this does not affect builds. The home-directory configuration
is outside this repository and was not changed.
