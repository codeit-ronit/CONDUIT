import { evaluateBoundaryPolicy } from "../src/index.js";
import type { BoundaryPolicyContext } from "../src/index.js";
import { describe, expect, it } from "vitest";

function context(
  overrides: Partial<BoundaryPolicyContext> = {},
): BoundaryPolicyContext {
  return {
    reconciliation: {
      toolName: "catalog.search",
      providerId: "internal",
      status: "APPROVED",
      discoveredHash: "a",
      approvedHash: "a",
      classification: "READ_ONLY",
    },
    trustState: "CLEAN",
    classification: "READ_ONLY",
    inputValid: true,
    humanApprovalId: null,
    ...overrides,
  };
}

describe("boundary policy", () => {
  it("fails closed for unknown and changed tools", () => {
    expect(
      evaluateBoundaryPolicy(
        context({ reconciliation: { ...context().reconciliation, status: "UNKNOWN" } }),
      ),
    ).toMatchObject({ outcome: "DENY", reason: "UNKNOWN_TOOL" });
    expect(
      evaluateBoundaryPolicy(
        context({
          reconciliation: { ...context().reconciliation, status: "SCHEMA_DRIFT" },
        }),
      ),
    ).toMatchObject({ outcome: "DENY", reason: "TOOL_SCHEMA_DRIFT" });
  });

  it("narrows binding permission after untrusted prose", () => {
    expect(
      evaluateBoundaryPolicy(
        context({ trustState: "QUARANTINED", classification: "BINDING_WRITE" }),
      ),
    ).toMatchObject({ outcome: "REQUIRE_APPROVAL", reason: "PERMISSION_NARROWED" });
  });

  it("accepts an explicit approval without treating prose as trusted", () => {
    expect(
      evaluateBoundaryPolicy(
        context({
          trustState: "QUARANTINED",
          classification: "BINDING_WRITE",
          humanApprovalId: "approval-123",
        }),
      ),
    ).toMatchObject({ outcome: "ALLOW", reason: "HUMAN_APPROVAL_ACCEPTED" });
  });
});
