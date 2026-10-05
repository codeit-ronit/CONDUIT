import { describe, expect, it } from "vitest";

import {
  BoundedBuyerRuntime,
  FlawedBuyerModel,
  GeminiInteractionsBuyerModel,
  OpenAIResponsesBuyerModel,
  ScriptedBuyerModel,
} from "../src/index.js";
import type {
  BuyerTools,
  CartView,
  CommitToolResult,
  IntentRequest,
  ModelCallTelemetry,
} from "../src/index.js";

const merchantId = "018f47a6-d879-7d3a-9f5a-96a73f0e11a2";
const productId = "018f47a6-d879-7d3a-9f5a-96a73f0e11a3";
const request: IntentRequest = {
  request: "Dinner for two under ₹800, vegetarian and no beef",
  merchantId,
  currency: "INR",
  defaultMaximumMinorUnits: "80000",
};

class FakeTools implements BuyerTools {
  public calls: string[] = [];
  private cart: CartView | null = null;

  public searchCatalog() {
    this.calls.push("catalog.search");
    return Promise.resolve({
      products: [
        {
          productId,
          sku: "PANEER-01",
          category: "dinner",
          attributes: { vegetarian: true },
          unitPriceMinorUnits: "19900",
          availableQuantity: 25,
        },
      ],
      untrustedTextObserved: true,
    });
  }

  public setCartLine(selectedProductId: string, quantity: number) {
    this.calls.push("cart.set_line");
    this.cart = {
      cartId: "018f47a6-d879-7d3a-9f5a-96a73f0e11a4",
      currency: "INR",
      totalMinorUnits: "39800",
      lines: [
        {
          productId: selectedProductId,
          sku: "PANEER-01",
          quantity,
          unitPriceMinorUnits: "19900",
          lineTotalMinorUnits: "39800",
        },
      ],
    };
    return Promise.resolve(this.cart);
  }

  public reviewCart() {
    this.calls.push("cart.review");
    if (!this.cart) throw new Error("Cart does not exist");
    return Promise.resolve(this.cart);
  }

  public commit(statedTotalMinorUnits: string): Promise<CommitToolResult> {
    this.calls.push("purchase.commit");
    return Promise.resolve(
      statedTotalMinorUnits === "39800"
        ? {
            outcome: "CONFIRMED",
            chargedMinorUnits: "39800",
            evidence: { source: "server" },
          }
        : {
            outcome: "DENIED",
            reason: "STATED_TOTAL_MISMATCH",
            recoveryAction: "Use the fresh server quote.",
            evidence: { charged: false },
          },
    );
  }
}

describe("bounded buyer runtime", () => {
  it("does nothing until the exact typed intent is confirmed", async () => {
    const tools = new FakeTools();
    const runtime = new BoundedBuyerRuntime(new ScriptedBuyerModel(), tools);
    const proposal = await runtime.proposeIntent(request);
    expect(tools.calls).toEqual([]);

    const result = await runtime.runConfirmed(proposal, "wrong-fingerprint");
    expect(result.state).toBe("FAILED");
    expect(tools.calls).toEqual([]);
  });

  it("completes through deterministic tools with a server total", async () => {
    const tools = new FakeTools();
    const runtime = new BoundedBuyerRuntime(new ScriptedBuyerModel(), tools);
    const proposal = await runtime.proposeIntent(request);
    const result = await runtime.runConfirmed(proposal, proposal.fingerprint);

    expect(result.state).toBe("SUCCEEDED");
    expect(result.commit).toMatchObject({
      outcome: "CONFIRMED",
      chargedMinorUnits: "39800",
    });
    expect(tools.calls).toEqual([
      "catalog.search",
      "cart.set_line",
      "cart.review",
      "purchase.commit",
    ]);
  });

  it("rejects malformed model output before any tool side effect", async () => {
    const tools = new FakeTools();
    const runtime = new BoundedBuyerRuntime(
      new FlawedBuyerModel("MALFORMED_OUTPUT"),
      tools,
    );
    await expect(runtime.proposeIntent(request)).rejects.toThrow();
    expect(tools.calls).toEqual([]);
  });

  it("does not charge a deliberately wrong stated total", async () => {
    const tools = new FakeTools();
    const runtime = new BoundedBuyerRuntime(new FlawedBuyerModel("WRONG_TOTAL"), tools);
    const proposal = await runtime.proposeIntent(request);
    const result = await runtime.runConfirmed(proposal, proposal.fingerprint);

    expect(result.state).toBe("REFUSED");
    expect(result.commit).toMatchObject({
      outcome: "DENIED",
      reason: "STATED_TOTAL_MISMATCH",
    });
    expect(result.commit).not.toHaveProperty("chargedMinorUnits");
  });

  it("stops a repeated-action loop within its explicit budget", async () => {
    const tools = new FakeTools();
    const runtime = new BoundedBuyerRuntime(
      new FlawedBuyerModel("REPEATED_ACTION"),
      tools,
      { maxSteps: 6, maxDurationMs: 15_000, maxRepeatedAction: 2 },
    );
    const proposal = await runtime.proposeIntent(request);
    const result = await runtime.runConfirmed(proposal, proposal.fingerprint);

    expect(result.state).toBe("FAILED");
    expect(result.failureReason).toContain("Loop detected");
    expect(result.stepsUsed).toBe(3);
    expect(tools.calls.filter((call) => call === "cart.set_line")).toHaveLength(2);
  });

  it("refuses an unsatisfiable request without asking the model to relax it", async () => {
    const tools = new FakeTools();
    const runtime = new BoundedBuyerRuntime(
      new ScriptedBuyerModel({ maximumMinorUnits: "100" }),
      tools,
    );
    const proposal = await runtime.proposeIntent(request);
    const result = await runtime.runConfirmed(proposal, proposal.fingerprint);

    expect(result.state).toBe("REFUSED");
    expect(result.failureReason).toContain("none were relaxed");
    expect(tools.calls).toEqual(["catalog.search"]);
  });

  it("runs the same contract through the live adapter with a mocked transport", async () => {
    const telemetry: ModelCallTelemetry[] = [];
    const responses = [
      {
        schemaVersion: "buyer-intent-v1",
        merchantId,
        currency: "INR",
        maximumMinorUnits: "80000",
        category: "dinner",
        quantity: 2,
        excludedTerms: ["beef"],
        requiredAttributes: { vegetarian: "true" },
        summary: "Two safe vegetarian dinners.",
      },
      {
        kind: "SELECT_PRODUCT",
        productId,
        quantity: 2,
        statedTotalMinorUnits: null,
        reason: "Select filtered candidate.",
      },
      {
        kind: "COMMIT",
        productId: null,
        quantity: null,
        statedTotalMinorUnits: "39800",
        reason: "Echo server total.",
      },
    ];
    const fakeFetch: typeof fetch = () => {
      const output = responses.shift();
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: "resp_test",
            model: "resolved-test-model",
            output_text: JSON.stringify(output),
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-request-id": "request_test",
            },
          },
        ),
      );
    };
    const tools = new FakeTools();
    const runtime = new BoundedBuyerRuntime(
      new OpenAIResponsesBuyerModel({
        apiKey: "test-key",
        model: "test-model",
        fetchImplementation: fakeFetch,
        observe: (event) => telemetry.push(event),
      }),
      tools,
    );
    const proposal = await runtime.proposeIntent(request);
    const result = await runtime.runConfirmed(proposal, proposal.fingerprint);
    expect(result.state).toBe("SUCCEEDED");
    expect(telemetry).toHaveLength(3);
    expect(telemetry[0]).toMatchObject({
      provider: "OPENAI",
      requestedModel: "test-model",
      resolvedModel: "resolved-test-model",
      providerRequestId: "request_test",
      status: "COMPLETED",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
  });

  it("uses Gemini structured output without changing the buyer contract", async () => {
    const telemetry: ModelCallTelemetry[] = [];
    let sentBody: unknown;
    const fakeFetch: typeof fetch = (_input, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected JSON body");
      sentBody = JSON.parse(init.body) as unknown;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            interaction_id: "interaction_test",
            model: "gemini-resolved",
            output_text: JSON.stringify({
              schemaVersion: "buyer-intent-v1",
              merchantId,
              currency: "INR",
              maximumMinorUnits: "80000",
              category: "dinner",
              quantity: 2,
              excludedTerms: ["beef"],
              requiredAttributes: { vegetarian: "true" },
              summary: "Two safe vegetarian dinners.",
            }),
            usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    };
    const model = new GeminiInteractionsBuyerModel({
      apiKey: "test-key",
      model: "gemini-test",
      fetchImplementation: fakeFetch,
      observe: (event) => telemetry.push(event),
    });

    const proposal = await model.proposeIntent(request);

    expect(proposal).toMatchObject({ maximumMinorUnits: "80000" });
    expect(sentBody).toMatchObject({
      model: "gemini-test",
      store: false,
      response_format: { type: "text", mime_type: "application/json" },
    });
    expect(telemetry[0]).toMatchObject({
      provider: "GOOGLE_GEMINI",
      providerRequestId: "interaction_test",
      status: "COMPLETED",
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
    });
  });
});
