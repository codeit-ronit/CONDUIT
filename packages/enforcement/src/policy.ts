import type {
  BoundaryDecision,
  RunTrustState,
  ToolClassification,
  ToolReconciliation,
} from "./types.js";

export interface BoundaryPolicyContext {
  readonly reconciliation: ToolReconciliation;
  readonly trustState: RunTrustState;
  readonly classification: ToolClassification | null;
  readonly inputValid: boolean;
  readonly humanApprovalId: string | null;
}

/** Closed, pure, fail-closed boundary policy. */
export function evaluateBoundaryPolicy(
  context: BoundaryPolicyContext,
): BoundaryDecision {
  if (context.reconciliation.status === "UNKNOWN") {
    return deny(
      "UNKNOWN_TOOL",
      "The discovered tool has no approved snapshot.",
      "An operator must review and approve this exact tool schema.",
    );
  }
  if (context.reconciliation.status === "SCHEMA_DRIFT") {
    return deny(
      "TOOL_SCHEMA_DRIFT",
      "The live tool schema differs from its approved snapshot.",
      "Review the schema diff and explicitly approve the new version.",
    );
  }
  if (!context.inputValid) {
    return deny(
      "INVALID_TOOL_ARGUMENTS",
      "The proposed arguments do not match the approved tool contract.",
      "Repair the typed arguments before proposing the call again.",
    );
  }
  if (
    context.trustState === "QUARANTINED" &&
    (context.classification === "BINDING_WRITE" ||
      context.classification === "EXTERNAL_EFFECT")
  ) {
    if (context.humanApprovalId !== null) {
      return {
        outcome: "ALLOW",
        reason: "HUMAN_APPROVAL_ACCEPTED",
        explanation: "A human explicitly approved this narrowed high-impact call.",
        recoveryAction: null,
      };
    }
    return {
      outcome: "REQUIRE_APPROVAL",
      reason: "PERMISSION_NARROWED",
      explanation:
        "This run has seen untrusted merchant prose, so binding permissions are narrowed.",
      recoveryAction: "Show the typed call to a human and obtain explicit approval.",
    };
  }
  return {
    outcome: "ALLOW",
    reason: "TOOL_ALLOWED",
    explanation:
      "The tool, schema, arguments, and current run permissions are approved.",
    recoveryAction: null,
  };
}

function deny(
  reason: "UNKNOWN_TOOL" | "TOOL_SCHEMA_DRIFT" | "INVALID_TOOL_ARGUMENTS",
  explanation: string,
  recoveryAction: string,
): BoundaryDecision {
  return { outcome: "DENY", reason, explanation, recoveryAction };
}
