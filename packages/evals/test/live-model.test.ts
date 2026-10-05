import { describe, expect, it } from "vitest";

import {
  phase8LiveModelManifest,
  runLiveModelExperiment,
  validateLiveModelManifest,
} from "../src/index.js";

describe("live-model experiment contract", () => {
  it("does not label an unconfigured experiment as live evidence", async () => {
    const report = await runLiveModelExperiment({
      targets: [
        {
          provider: "OPENAI",
          requestedModel: "not-configured",
          configured: false,
          missingConfiguration: ["OPENAI_API_KEY", "OPENAI_MODEL"],
        },
      ],
      execute: () => Promise.reject(new Error("must not execute")),
      now: () => new Date("2026-10-05T00:00:00.000Z"),
    });

    expect(report.status).toBe("NOT_RUN");
    expect(report.evidenceTier).toBe("NONE");
    expect(report.trials).toEqual([]);
    expect(report.summaryByArm.GUARDRAILS_ENABLED.trialCount).toBe(0);
    expect(report.manifestDigest).toHaveLength(64);
  });

  it("publishes denominators and keeps hard effects separate from steering", async () => {
    const compactManifest = {
      ...phase8LiveModelManifest,
      repetitions: 2,
      scenarios: phase8LiveModelManifest.scenarios.slice(0, 2),
    };
    const targets = ["OPENAI", "GOOGLE_GEMINI"].map((provider) => ({
      provider,
      requestedModel: `${provider.toLowerCase()}-test`,
      configured: true,
      missingConfiguration: [],
    }));
    const report = await runLiveModelExperiment({
      manifest: compactManifest,
      targets,
      execute: ({ arm }) =>
        Promise.resolve({
          outcome: "COMPLETED",
          unauthorizedExternalEffects: arm === "GUARDRAILS_DISABLED_CONTROL" ? 1 : 0,
          selectionSteered: arm === "GUARDRAILS_DISABLED_CONTROL",
          malformedOutput: false,
          durationMs: 20,
          inputTokens: 10,
          outputTokens: 5,
          estimatedCostUsd: null,
          resolvedModel: "resolved",
          redactedTraceDigest: "a".repeat(64),
          errorCode: null,
        }),
      now: () => new Date("2026-10-05T00:00:00.000Z"),
    });

    expect(report.status).toBe("COMPLETE");
    expect(report.trials).toHaveLength(16);
    expect(report.summaryByArm.GUARDRAILS_ENABLED).toMatchObject({
      trialCount: 8,
      unauthorizedExternalEffects: 0,
      steeringEvents: 0,
    });
    expect(report.summaryByArm.GUARDRAILS_DISABLED_CONTROL).toMatchObject({
      trialCount: 8,
      unauthorizedExternalEffects: 8,
      steeringEvents: 8,
    });
  });

  it("rejects one-shot manifests", () => {
    expect(() => {
      validateLiveModelManifest({ ...phase8LiveModelManifest, repetitions: 1 });
    }).toThrow("at least two repetitions");
  });
});
