export type ModelProvider = "OPENAI" | "GOOGLE_GEMINI";

export type ModelOperation = "PROPOSE_INTENT" | "NEXT_ACTION";

export type ModelCallStatus =
  "COMPLETED" | "REFUSED" | "INCOMPLETE" | "PROVIDER_ERROR" | "INVALID_OUTPUT";

export interface ModelTokenUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
}

/** Redacted operational evidence. Prompts, outputs, and credentials never belong here. */
export interface ModelCallTelemetry {
  readonly provider: ModelProvider;
  readonly requestedModel: string;
  readonly resolvedModel: string | null;
  readonly operation: ModelOperation;
  readonly status: ModelCallStatus;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly providerRequestId: string | null;
  readonly usage: ModelTokenUsage;
  readonly errorCode: string | null;
}

export type ModelTelemetryObserver = (event: ModelCallTelemetry) => void;

export const emptyTokenUsage: ModelTokenUsage = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
};
