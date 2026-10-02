import { randomUUID, createHash } from "node:crypto";

import type { TenantId } from "@conduit/domain";
import {
  RedactionSession,
  canonicalJson,
  verifyAuditChain,
} from "@conduit/observability";
import type { AuditVerification, JsonValue } from "@conduit/observability";

import { evaluateBoundaryPolicy } from "./policy.js";
import { toolSchemaHash } from "./schema-snapshot.js";
import type {
  AuditEvent,
  BoundaryInvocation,
  BoundaryInvocationResult,
  BoundaryReasonCode,
  BoundaryRepository,
  BoundaryRun,
  ToolClassification,
  ToolDescriptor,
  ToolReconciliation,
  ToolRuntime,
} from "./types.js";

export class ToolBoundary {
  readonly #redactors = new Map<string, RedactionSession>();

  public constructor(
    private readonly repository: BoundaryRepository,
    private readonly runtime: ToolRuntime,
  ) {}

  public async startRun(
    tenantId: TenantId,
    operatorInput: string,
    knownSensitiveValues: readonly string[] = [],
  ): Promise<{ readonly run: BoundaryRun; readonly operatorContext: JsonValue }> {
    const run = await this.repository.startRun(tenantId, randomUUID());
    const redactor = new RedactionSession();
    for (const sensitiveValue of knownSensitiveValues)
      redactor.register(sensitiveValue);
    this.#redactors.set(run.id, redactor);
    return {
      run,
      operatorContext: {
        label: "OPERATOR",
        value: redactor.redactText(operatorInput),
      },
    };
  }

  public async approveDiscoveredTool(
    tenantId: TenantId,
    toolName: string,
    classification: ToolClassification,
  ) {
    const descriptor = (await this.runtime.discoverTools()).find(
      (tool) => tool.name === toolName,
    );
    if (!descriptor) throw new Error("Cannot approve a tool that was not discovered");
    return this.repository.approveTool(
      tenantId,
      descriptor,
      classification,
      toolSchemaHash(descriptor),
    );
  }

  public async reconcileTools(
    tenantId: TenantId,
  ): Promise<readonly ToolReconciliation[]> {
    const discovered = await this.runtime.discoverTools();
    return Promise.all(discovered.map((tool) => this.reconcileTool(tenantId, tool)));
  }

  public async invoke(input: BoundaryInvocation): Promise<BoundaryInvocationResult> {
    const callId = randomUUID();
    const run = await this.repository.getRun(input.tenantId, input.runId);
    const redactor = this.redactorFor(run.id);
    let descriptor: ToolDescriptor | undefined;
    let discoveryFailed = false;
    try {
      descriptor = (await this.runtime.discoverTools()).find(
        (tool) => tool.name === input.toolName,
      );
    } catch {
      discoveryFailed = true;
    }

    if (discoveryFailed || !descriptor) {
      const decision = {
        outcome: "DENY" as const,
        reason: discoveryFailed
          ? ("DISCOVERY_FAILED" as const)
          : ("TOOL_NOT_DISCOVERED" as const),
        explanation: discoveryFailed
          ? "Runtime tool discovery failed; the boundary fails closed."
          : "The requested tool is not present in the runtime discovery result.",
        recoveryAction:
          "Restore discovery and reconcile the live tool set before retrying.",
      };
      const reconciliation: ToolReconciliation = {
        toolName: input.toolName,
        providerId: this.runtime.providerId,
        status: "UNKNOWN",
        discoveredHash: "",
        approvedHash: null,
        classification: null,
      };
      await this.auditBlocked(
        input,
        callId,
        run,
        redactor,
        decision.reason,
        decision.outcome,
        reconciliation,
      );
      return {
        callId,
        decision,
        reconciliation,
        beforeTrustState: run.trustState,
        afterTrustState: run.trustState,
        forwarded: false,
        result: null,
      };
    }

    const reconciliation = await this.reconcileTool(input.tenantId, descriptor);
    const decision = evaluateBoundaryPolicy({
      reconciliation,
      trustState: run.trustState,
      classification: reconciliation.classification,
      inputValid:
        reconciliation.status === "APPROVED" &&
        this.runtime.validateInput(input.toolName, input.input),
      humanApprovalId: input.humanApprovalId ?? null,
    });
    const fingerprint = contextFingerprint(run, reconciliation);
    await this.appendAudit(input, callId, redactor, {
      runId: input.runId,
      callId,
      correlationId: input.correlationId,
      phase: "DECISION",
      toolName: input.toolName,
      classification: reconciliation.classification ?? "UNCLASSIFIED",
      decision: decision.outcome,
      reason: decision.reason,
      outcome: decision.outcome === "ALLOW" ? "FORWARDED" : "BLOCKED",
      policyVersion: run.policyVersion,
      contextFingerprint: fingerprint,
      payload: {
        arguments: redactor.redactJson(input.input),
        explanation: decision.explanation,
        recoveryAction: decision.recoveryAction,
      },
    });

    if (decision.outcome !== "ALLOW") {
      await this.appendOutcome(
        input,
        callId,
        redactor,
        run,
        reconciliation,
        decision.outcome,
        decision.reason,
        "BLOCKED",
        { message: "Tool execution was blocked before forwarding." },
      );
      return {
        callId,
        decision,
        reconciliation,
        beforeTrustState: run.trustState,
        afterTrustState: run.trustState,
        forwarded: false,
        result: null,
      };
    }

    try {
      const execution = await this.runtime.execute(input.toolName, input.input);
      const structured = redactor.redactJson(execution.structuredData);
      const quarantinedText = execution.untrustedText.map((text) => ({
        label: "UNTRUSTED_PROSE" as const,
        value: quarantine(redactor.redactText(text), run.quarantineNonce),
      }));
      const afterRun =
        quarantinedText.length > 0
          ? await this.repository.markRunQuarantined(input.tenantId, input.runId)
          : run;
      await this.appendOutcome(
        input,
        callId,
        redactor,
        run,
        reconciliation,
        decision.outcome,
        decision.reason,
        "SUCCEEDED",
        {
          structured,
          quarantinedText: quarantinedText.map((item) => item.value),
          claimLevel: execution.claimLevel,
        },
      );
      return {
        callId,
        decision,
        reconciliation,
        beforeTrustState: run.trustState,
        afterTrustState: afterRun.trustState,
        forwarded: true,
        result: {
          structured: { label: "TOOL_STRUCTURED", value: structured },
          quarantinedText,
          claimLevel: execution.claimLevel,
        },
      };
    } catch (error: unknown) {
      await this.appendOutcome(
        input,
        callId,
        redactor,
        run,
        reconciliation,
        decision.outcome,
        "TOOL_EXECUTION_FAILED",
        "FAILED",
        { message: error instanceof Error ? error.message : "Tool execution failed" },
      );
      throw error;
    }
  }

  public async verifyAudit(tenantId: TenantId): Promise<AuditVerification> {
    return verifyAuditChain(await this.repository.listAudit(tenantId));
  }

  private async reconcileTool(
    tenantId: TenantId,
    descriptor: ToolDescriptor,
  ): Promise<ToolReconciliation> {
    const discoveredHash = toolSchemaHash(descriptor);
    const approval = await this.repository.getToolApproval(
      tenantId,
      descriptor.providerId,
      descriptor.name,
    );
    if (!approval?.enabled) {
      return {
        toolName: descriptor.name,
        providerId: descriptor.providerId,
        status: "UNKNOWN",
        discoveredHash,
        approvedHash: approval?.schemaHash ?? null,
        classification: approval?.classification ?? null,
      };
    }
    return {
      toolName: descriptor.name,
      providerId: descriptor.providerId,
      status: approval.schemaHash === discoveredHash ? "APPROVED" : "SCHEMA_DRIFT",
      discoveredHash,
      approvedHash: approval.schemaHash,
      classification: approval.classification,
    };
  }

  private async auditBlocked(
    input: BoundaryInvocation,
    callId: string,
    run: BoundaryRun,
    redactor: RedactionSession,
    reason: "DISCOVERY_FAILED" | "TOOL_NOT_DISCOVERED",
    decision: "DENY",
    reconciliation: ToolReconciliation,
  ): Promise<void> {
    const base = {
      runId: input.runId,
      callId,
      correlationId: input.correlationId,
      toolName: input.toolName,
      classification: "UNCLASSIFIED" as const,
      decision,
      reason,
      policyVersion: run.policyVersion,
      contextFingerprint: contextFingerprint(run, reconciliation),
    };
    await this.appendAudit(input, callId, redactor, {
      ...base,
      phase: "DECISION",
      outcome: "BLOCKED",
      payload: { arguments: redactor.redactJson(input.input) },
    });
    await this.appendAudit(input, callId, redactor, {
      ...base,
      phase: "OUTCOME",
      outcome: "BLOCKED",
      payload: { message: "Fail-closed before execution." },
    });
  }

  private async appendOutcome(
    input: BoundaryInvocation,
    callId: string,
    redactor: RedactionSession,
    run: BoundaryRun,
    reconciliation: ToolReconciliation,
    decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL",
    reason: BoundaryReasonCode,
    outcome: "BLOCKED" | "SUCCEEDED" | "FAILED",
    payload: JsonValue,
  ): Promise<void> {
    await this.appendAudit(input, callId, redactor, {
      runId: input.runId,
      callId,
      correlationId: input.correlationId,
      phase: "OUTCOME",
      toolName: input.toolName,
      classification: reconciliation.classification ?? "UNCLASSIFIED",
      decision,
      reason,
      outcome,
      policyVersion: run.policyVersion,
      contextFingerprint: contextFingerprint(run, reconciliation),
      payload,
    });
  }

  private async appendAudit(
    input: BoundaryInvocation,
    _callId: string,
    redactor: RedactionSession,
    event: AuditEvent,
  ): Promise<void> {
    await this.repository.appendAudit(input.tenantId, {
      ...event,
      correlationId: redactor.redactText(event.correlationId),
      toolName: redactor.redactText(event.toolName),
      payload: redactor.redactJson(event.payload),
    });
  }

  private redactorFor(runId: string): RedactionSession {
    const existing = this.#redactors.get(runId);
    if (existing) return existing;
    const created = new RedactionSession();
    this.#redactors.set(runId, created);
    return created;
  }
}

function quarantine(text: string, nonce: string): string {
  return `<CONDUIT_UNTRUSTED_${nonce}>\n${text}\n</CONDUIT_UNTRUSTED_${nonce}>`;
}

function contextFingerprint(
  run: BoundaryRun,
  reconciliation: ToolReconciliation,
): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        policyVersion: run.policyVersion,
        trustState: run.trustState,
        toolName: reconciliation.toolName,
        classification: reconciliation.classification,
        schemaHash: reconciliation.discoveredHash,
      }),
      "utf8",
    )
    .digest("hex");
}
