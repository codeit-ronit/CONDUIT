# ADR-0001: Rebuild around a deterministic trust kernel

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

The prior project contains strong techniques but became too complicated to
understand and has documented correctness, scaling, security, and claim gaps.
Copying its architecture would also copy its accidental complexity.

## Decision

Treat `CONDUIT-KT.md` as research input. Preserve independently defensible
invariants, then rebuild in thin vertical slices around a small deterministic
trust kernel. No prior class count, folder layout, framework, or claimed metric
is inherited automatically.

## Consequences

- Early progress may look slower because contracts and threat boundaries come
  before a polished demo.
- Every major mechanism must earn its place through a failure it prevents and an
  observable test.
- The new implementation may be much smaller while providing stronger evidence.
