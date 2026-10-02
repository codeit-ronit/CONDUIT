# ADR-0004: Version catalog prices and snapshot committed order lines

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

A mutable price column loses the answer to “what price did the system see when it
committed this purchase?” Reading live catalog data for an old receipt also allows a
later merchant price change to rewrite apparent transaction history.

## Decision

Store catalog prices as non-overlapping versions with exactly one current version. Carts
always read the current version. At commit, copy the chosen price version and exact
money values into immutable order-line snapshots.

PostgreSQL generates the shared close/open timestamp for a price change in one SQL
statement. JavaScript does not provide the authoritative price-history time.

## Consequences

- We can explain every current and historical price.
- Old receipts remain stable after catalog changes.
- Storage grows with price changes, which is intentional audit history.
- Phase 2 can compare the agent's observed version with the live version and produce an
  itemized reprice divergence.
