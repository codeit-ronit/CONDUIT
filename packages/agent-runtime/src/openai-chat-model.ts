import { buyerActionSchema, shoppingIntentProposalSchema } from "@conduit/contracts";
import { z } from "zod";

import { emptyTokenUsage } from "./model-telemetry.js";
import type {
  ModelCallStatus,
  ModelOperation,
  ModelProvider,
  ModelTelemetryObserver,
  ModelTokenUsage,
} from "./model-telemetry.js";
import { intentPrompt, nextActionPrompt } from "./model-prompts.js";
import type { BuyerModel, IntentRequest, ModelTurnContext } from "./types.js";

export interface OpenAIChatModelOptions {
  readonly provider: Exclude<ModelProvider, "OPENAI" | "GOOGLE_GEMINI">;
  readonly apiKey: string;
  readonly model: string;
  readonly endpoint: string;
  readonly fetchImplementation?: typeof fetch;
  readonly observe?: ModelTelemetryObserver;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Shared adapter for providers exposing the OpenAI-compatible Chat Completions API. */
export class OpenAIChatBuyerModel implements BuyerModel {
  public readonly id: string;
  public readonly claimLevel = "LIVE_MODEL" as const;
  readonly #fetch: typeof fetch;

  public constructor(private readonly options: OpenAIChatModelOptions) {
    if (options.model.length === 0) throw new Error("Chat model is required");
    this.id = `${options.provider.toLowerCase()}:${options.model}`;
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
      response = await this.#fetch(this.options.endpoint, {
        method: "POST",
        headers: {
          ...(this.options.apiKey
            ? { authorization: `Bearer ${this.options.apiKey}` }
            : {}),
          "content-type": "application/json",
          ...this.options.headers,
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: [
            {
              role: "user",
              content: `${input}\nReturn only a JSON object matching this schema. Do not include $schema or any fields not required by the schema:\n${JSON.stringify(withoutSchemaMeta(z.toJSONSchema(schema)))}`,
            },
          ],
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
      payload = await response.json();
      if (!response.ok) {
        errorCode = `HTTP_${String(response.status)}`;
        throw new Error(
          `${this.options.provider} Chat API returned ${String(response.status)}: ${summarizeProviderError(payload)}`,
        );
      }
      const text = extractChatText(payload);
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
      errorCode ??= error instanceof Error ? error.name : "UNKNOWN_ERROR";
      throw error;
    } finally {
      this.options.observe?.({
        provider: this.options.provider,
        requestedModel: this.options.model,
        resolvedModel: readString(payload, "model"),
        operation,
        status,
        startedAt,
        durationMs: Math.max(0, now() - started),
        providerRequestId:
          response?.headers.get("x-request-id") ?? readString(payload, "id"),
        usage: readUsage(payload),
        errorCode,
      });
    }
  }
}

function extractChatText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices))
    throw new Error("Chat response had no choices");
  const first: unknown = payload.choices[0] as unknown;
  if (!isRecord(first) || !isRecord(first.message))
    throw new Error("Chat response had no message");
  if (typeof first.message.refusal === "string")
    throw new Error("Chat model refused the request");
  if (typeof first.message.content !== "string")
    throw new Error("Chat response had no text content");
  return first.message.content;
}

function readUsage(payload: unknown): ModelTokenUsage {
  if (!isRecord(payload) || !isRecord(payload.usage)) return emptyTokenUsage;
  return {
    inputTokens: readNumber(payload.usage, "prompt_tokens"),
    outputTokens: readNumber(payload.usage, "completion_tokens"),
    totalTokens: readNumber(payload.usage, "total_tokens"),
  };
}

function withoutSchemaMeta<T>(schema: T): T {
  if (!isRecord(schema)) return schema;
  const withoutMeta = { ...schema };
  delete withoutMeta.$schema;
  return withoutMeta;
}

function summarizeProviderError(payload: unknown): string {
  if (!isRecord(payload)) return "no provider details";
  if (isRecord(payload.error) && typeof payload.error.message === "string")
    return payload.error.message.slice(0, 240);
  return typeof payload.message === "string"
    ? payload.message.slice(0, 240)
    : "no provider details";
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
