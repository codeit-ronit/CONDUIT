# Development Environment

**Checked:** 2026-10-02

| Tool    | Detected            | Project status                                  |
| ------- | ------------------- | ----------------------------------------------- |
| macOS   | Darwin 25.6.0 arm64 | Supported development host                      |
| Node.js | 22.21.1             | Ready; satisfies `>=22.12.0`                    |
| pnpm    | 10.25.0             | Ready and pinned in `packageManager`            |
| npm     | 10.9.4              | Available for registry inspection               |
| Git     | 2.52.0              | Ready                                           |
| Docker  | Not installed       | Blocks containerized PostgreSQL work in Phase 1 |
| `psql`  | Not installed       | Blocks direct local PostgreSQL inspection       |

## Toolchain selection

On 2026-10-02, the npm registry reported TypeScript 7.0.2 as latest, but
TypeScript-ESLint 8.71.0 declared support for TypeScript `<6.1.0`. We therefore pinned
TypeScript 6.0.3. This avoids an unsupported combination while keeping the decision
visible and reproducible.

## Non-blocking shell warning

Every login shell currently reports a missing Flutter path from `~/.zshenv`. CONDUIT
does not use Flutter, so this does not affect builds. The home-directory configuration
is outside this repository and was not changed.
