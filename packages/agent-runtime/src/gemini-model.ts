import { buyerActionSchema, shoppingIntentProposalSchema } from "@conduit/contracts";
import { z } from "zod";

import { emptyTokenUsage } from "./model-telemetry.js";
import type {
  ModelCallStatus,
  ModelOperation,
  ModelTelemetryObserver,
  ModelTokenUsage,
} from "./model-telemetry.js";
import { intentPrompt, nextActionPrompt } from "./model-prompts.js";
import type { BuyerModel, IntentRequest, ModelTurnContext } from "./types.js";

export interface GeminiInteractionsModelOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly endpoint?: string;
  readonly fetchImplementation?: typeof fetch;
  readonly observe?: ModelTelemetryObserver;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

/** Google Gemini Interactions adapter with the same BuyerModel authority as OpenAI. */
export class GeminiInteractionsBuyerModel implements BuyerModel {
  public readonly id: string;
  public readonly claimLevel = "LIVE_MODEL" as const;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;

  public constructor(private readonly options: GeminiInteractionsModelOptions) {
    if (options.apiKey.length === 0) throw new Error("Gemini API key is required");
    if (options.model.length === 0) throw new Error("Gemini model is required");
    this.id = `google-gemini:${options.model}`;
    this.#endpoint =
      options.endpoint ??
      "https://generativelanguage.googleapis.com/v1beta/interactions";
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  public proposeIntent(input: IntentRequest): Promise<unknown> {
    return this.structured(
      "PROPOSE_INTENT",
      shoppingIntentProposalSchema,
      intentPrompt(input),
    );
  }

  public nextAction(context: ModelTurnContext): Promise<unknown> {
    return this.structured("NEXT_ACTION", buyerActionSchema, nextActionPrompt(context));
  }

  private async structured<T>(
    operation: ModelOperation,
    schema: z.ZodType<T>,
    input: string,
  ): Promise<T> {
    const now = this.options.now ?? Date.now;
    const started = now();
    const startedAt = new Date(started).toISOString();
    let response: Response | null = null;
    let payload: unknown;
    let status: ModelCallStatus = "PROVIDER_ERROR";
    let errorCode: string | null = null;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.options.apiKey,
        },
        body: JSON.stringify({
          model: this.options.model,
          input,
          store: false,
          response_format: {
            type: "text",
            mime_type: "application/json",
            schema: z.toJSONSchema(schema),
          },
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
      payload = await response.json();
      if (!response.ok) {
        errorCode = `HTTP_${String(response.status)}`;
        throw new Error(`Gemini Interactions API returned ${String(response.status)}`);
      }
      const text = extractGeminiText(payload);
      try {
        const result = schema.parse(JSON.parse(text) as unknown);
        status = "COMPLETED";
        return result;
      } catch (error: unknown) {
        status = "INVALID_OUTPUT";
        errorCode = "SCHEMA_VALIDATION_FAILED";
        throw error;
      }
    } catch (error: unknown) {
      status = preserveInvalidOutput(status);
      errorCode ??= error instanceof Error ? error.name : "UNKNOWN_ERROR";
      throw error;
    } finally {
      this.options.observe?.({
        provider: "GOOGLE_GEMINI",
        requestedModel: this.options.model,
        resolvedModel: readString(payload, "model"),
        operation,
        status,
        startedAt,
        durationMs: Math.max(0, now() - started),
        providerRequestId:
          response?.headers.get("x-request-id") ??
          readString(payload, "interaction_id") ??
          readString(payload, "id"),
        usage: readGeminiUsage(payload),
        errorCode,
      });
    }
  }
}

function preserveInvalidOutput(current: ModelCallStatus): ModelCallStatus {
  return current === "INVALID_OUTPUT" ? current : "PROVIDER_ERROR";
}

function extractGeminiText(payload: unknown): string {
  if (!isRecord(payload)) throw new Error("Gemini response was not an object");
  if (typeof payload.output_text === "string") return payload.output_text;
  if (
    isRecord(payload.interaction) &&
    typeof payload.interaction.output_text === "string"
  )
    return payload.interaction.output_text;
  throw new Error("Gemini response had no structured text output");
}

function readGeminiUsage(payload: unknown): ModelTokenUsage {
  if (!isRecord(payload)) return emptyTokenUsage;
  const usage = isRecord(payload.usage) ? payload.usage : payload.usage_metadata;
  if (!isRecord(usage)) return emptyTokenUsage;
  const inputTokens =
    readNumber(usage, "input_tokens") ?? readNumber(usage, "prompt_token_count");
  const outputTokens =
    readNumber(usage, "output_tokens") ?? readNumber(usage, "candidates_token_count");
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      readNumber(usage, "total_tokens") ?? readNumber(usage, "total_token_count"),
  };
}

function readString(value: unknown, key: string): string | null {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : null;
}

function readNumber(value: unknown, key: string): number | null {
  return isRecord(value) && typeof value[key] === "number" ? value[key] : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
