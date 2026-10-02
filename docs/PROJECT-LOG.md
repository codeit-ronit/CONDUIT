# Project Log

## 2026-10-02 — Knowledge transfer and V1 foundation

### What we did

- Read the complete 1,082-line knowledge-transfer document.
- Separated durable principles from the old implementation and its weaknesses.
- Checked current primary sources for MCP, UCP, ACP, AP2, x402, and prompt
  injection guidance.
- Found material protocol drift: UCP is now a concrete compatibility option and
  current AP2 v0.2 no longer matches the older three-mandate summary exactly.
- Defined a V1 product promise, phased implementation plan, architecture,
  research register, and decision-log process.
- Initialized local Git version control.

### Decisions and why

- **Rebuild, do not port.** This keeps the proven trust-boundary thesis without
  inheriting accidental complexity.
- **Canonical domain plus adapters.** External standards are useful and moving;
  the core business invariants must remain stable.
- **Database correctness from the start.** Concurrency, tenancy, idempotency,
  and money cannot be retrofitted safely after a demo architecture hardens.
- **AI outside the authority path.** This lets us use capable models without
  asking probabilistic software to guarantee financial invariants.

### Limits and unknowns

- No application code or provider integration exists yet.
- The TypeScript stack is proposed and must be validated in Phase 0.
- The payment provider is intentionally undecided because the KT file does not
  provide enough current, named, live-account evidence.
- No protocol-conformance claim is being made.

### Next action

Run the Phase 0 environment check, scaffold the workspace, implement `Money`
and foundational contracts, and add the first invariant/forbidden-import tests.
