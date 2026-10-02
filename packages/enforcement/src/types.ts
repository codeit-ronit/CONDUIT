import type { TenantId } from "@conduit/domain";
import type { AuditEntry, JsonValue } from "@conduit/observability";

export type ToolClassification =
  "READ_ONLY" | "REVERSIBLE_WRITE" | "BINDING_WRITE" | "EXTERNAL_EFFECT";

export type TrustLabel = "OPERATOR" | "TOOL_STRUCTURED" | "UNTRUSTED_PROSE";
export type RunTrustState = "CLEAN" | "QUARANTINED";

export interface ToolDescriptor {
  readonly providerId: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonValue;
  readonly outputSchema: JsonValue;
}

export interface ToolApproval {
  readonly tenantId: TenantId;
  readonly providerId: string;
  readonly toolName: string;
  readonly classification: ToolClassification;
  readonly schemaHash: string;
  readonly enabled: boolean;
  readonly approvedAt: Date;
}

export interface BoundaryRun {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly trustState: RunTrustState;
  readonly quarantineNonce: string;
  readonly policyVersion: "boundary-v1";
}

export type BoundaryReasonCode =
  | "TOOL_ALLOWED"
  | "HUMAN_APPROVAL_ACCEPTED"
  | "UNKNOWN_TOOL"
  | "TOOL_NOT_DISCOVERED"
  | "TOOL_SCHEMA_DRIFT"
  | "INVALID_TOOL_ARGUMENTS"
  | "PERMISSION_NARROWED"
  | "DISCOVERY_FAILED"
  | "TOOL_EXECUTION_FAILED";

export type BoundaryDecision =
  | {
      readonly outcome: "ALLOW";
      readonly reason: "TOOL_ALLOWED" | "HUMAN_APPROVAL_ACCEPTED";
      readonly explanation: string;
      readonly recoveryAction: null;
    }
  | {
      readonly outcome: "DENY" | "REQUIRE_APPROVAL";
      readonly reason: Exclude<
        BoundaryReasonCode,
        "TOOL_ALLOWED" | "HUMAN_APPROVAL_ACCEPTED" | "TOOL_EXECUTION_FAILED"
      >;
      readonly explanation: string;
      readonly recoveryAction: string;
    };

export interface ToolExecutionResult {
  readonly structuredData: JsonValue;
  readonly untrustedText: readonly string[];
  readonly claimLevel: "MODELLED" | "REAL" | "REFERENCED";
}

export interface ToolRuntime {
  readonly providerId: string;
  discoverTools(): Promise<readonly ToolDescriptor[]>;
  validateInput(toolName: string, input: JsonValue): boolean;
  execute(toolName: string, input: JsonValue): Promise<ToolExecutionResult>;
}

export interface AuditEvent {
  readonly runId: string;
  readonly callId: string;
  readonly correlationId: string;
  readonly phase: "DECISION" | "OUTCOME";
  readonly toolName: string;
  readonly classification: ToolClassification | "UNCLASSIFIED";
  readonly decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL";
  readonly reason: BoundaryReasonCode;
  readonly outcome: "FORWARDED" | "BLOCKED" | "SUCCEEDED" | "FAILED";
  readonly policyVersion: string;
  readonly contextFingerprint: string;
  readonly payload: JsonValue;
}

export interface BoundaryRepository {
  startRun(tenantId: TenantId, quarantineNonce: string): Promise<BoundaryRun>;
  getRun(tenantId: TenantId, runId: string): Promise<BoundaryRun>;
  markRunQuarantined(tenantId: TenantId, runId: string): Promise<BoundaryRun>;
  approveTool(
    tenantId: TenantId,
    descriptor: ToolDescriptor,
    classification: ToolClassification,
    schemaHash: string,
  ): Promise<ToolApproval>;
  getToolApproval(
    tenantId: TenantId,
    providerId: string,
    toolName: string,
  ): Promise<ToolApproval | null>;
  appendAudit(tenantId: TenantId, event: AuditEvent): Promise<AuditEntry>;
  listAudit(tenantId: TenantId, runId?: string): Promise<readonly AuditEntry[]>;
}

export interface ToolReconciliation {
  readonly toolName: string;
  readonly providerId: string;
  readonly status: "APPROVED" | "UNKNOWN" | "SCHEMA_DRIFT";
  readonly discoveredHash: string;
  readonly approvedHash: string | null;
  readonly classification: ToolClassification | null;
}

export interface BoundaryInvocation {
  readonly tenantId: TenantId;
  readonly runId: string;
  readonly toolName: string;
  readonly input: JsonValue;
  readonly correlationId: string;
  readonly humanApprovalId?: string;
}

export interface LabelledValue {
  readonly label: TrustLabel;
  readonly value: JsonValue;
}

export interface BoundaryInvocationResult {
  readonly callId: string;
  readonly decision: BoundaryDecision;
  readonly reconciliation: ToolReconciliation;
  readonly beforeTrustState: RunTrustState;
  readonly afterTrustState: RunTrustState;
  readonly forwarded: boolean;
  readonly result: {
    readonly structured: LabelledValue;
    readonly quarantinedText: readonly LabelledValue[];
    readonly claimLevel: "MODELLED" | "REAL" | "REFERENCED";
  } | null;
}
