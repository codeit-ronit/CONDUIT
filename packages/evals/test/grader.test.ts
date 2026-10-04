import { describe, expect, it } from "vitest";

import {
  assertEvaluationPasses,
  phase6SafetyManifest,
  runEvaluation,
  validateManifest,
  zeroMetrics,
} from "../src/index.js";

describe("versioned evaluation grading", () => {
  it("passes only when every prewritten expectation and hard-zero gate passes", async () => {
    const report = await runEvaluation(
      phase6SafetyManifest,
      (scenario) =>
        Promise.resolve({
          terminalState: scenario.expected.terminalState,
          evidenceTier: scenario.evidenceTier,
          hardZero: zeroMetrics(),
          facts: scenario.expected.facts,
        }),
      () => new Date("2026-10-04T12:00:00.000Z"),
    );
    expect(report).toMatchObject({
      outcome: "PASS",
      hardZeroPassed: true,
      passedScenarios: phase6SafetyManifest.scenarios.length,
      failedScenarios: 0,
    });
    expect(() => {
      assertEvaluationPasses(report);
    }).not.toThrow();
  });

  it("fails the build gate even when expectations pass but one leak is observed", async () => {
    const report = await runEvaluation(phase6SafetyManifest, (scenario) =>
      Promise.resolve({
        terminalState: scenario.expected.terminalState,
        evidenceTier: scenario.evidenceTier,
        hardZero: {
          ...zeroMetrics(),
          piiLeaks: scenario.id === "privacy-redaction" ? 1 : 0,
        },
        facts: scenario.expected.facts,
      }),
    );
    expect(report.outcome).toBe("FAIL");
    expect(report.hardZero.piiLeaks).toBe(1);
    expect(() => {
      assertEvaluationPasses(report);
    }).toThrow("Evaluation gate failed");
  });

  it("rejects duplicate scenario identifiers before execution", () => {
    const first = phase6SafetyManifest.scenarios[0];
    if (!first) throw new Error("manifest unexpectedly empty");
    expect(() => {
      validateManifest({
        ...phase6SafetyManifest,
        scenarios: [first, first],
      });
    }).toThrow("Duplicate");
  });
});
