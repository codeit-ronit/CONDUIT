import { describe, expect, it } from "vitest";

import { runRedTeamExperiment } from "../src/index.js";

describe("paired red-team experiment", () => {
  it("shows attacks are harmful without controls and safe with all controls", () => {
    const report = runRedTeamExperiment();
    expect(report.outcome).toBe("PASS");
    expect(report.guardrailsOn.severityCounts).toEqual({ L1: 2, L3: 0, L4: 0 });
    expect(report.guardrailsOff.severityCounts).toEqual({ L1: 2, L3: 1, L4: 1 });
    expect(report.causalControlDemonstrated).toBe(true);
  });

  it("attributes L3 protection to redaction without pretending quarantine is authority", () => {
    const report = runRedTeamExperiment();
    const noRedaction = report.ablations.find(
      (variant) => variant.id === "without-redaction",
    );
    const noQuarantine = report.ablations.find(
      (variant) => variant.id === "without-quarantine",
    );
    expect(noRedaction?.severityCounts).toEqual({ L1: 2, L3: 1, L4: 0 });
    expect(noQuarantine?.severityCounts).toEqual({ L1: 2, L3: 0, L4: 0 });
  });
});
