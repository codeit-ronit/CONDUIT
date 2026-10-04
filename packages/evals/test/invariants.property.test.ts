import {
  Money,
  calculateAuthorizationExposure,
  purchaseOperationId,
} from "@conduit/domain";
import { evaluateBoundaryPolicy } from "@conduit/enforcement";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

describe("generated trust invariants", () => {
  it("exact money addition and subtraction round-trip for generated integers", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -10_000_000_000n, max: 10_000_000_000n }),
        fc.bigInt({ min: -10_000_000_000n, max: 10_000_000_000n }),
        (left, right) => {
          const original = Money.fromMinorUnits("INR", left);
          expect(
            original
              .add(Money.fromMinorUnits("INR", right))
              .subtract(Money.fromMinorUnits("INR", right))
              .equals(original),
          ).toBe(true);
        },
      ),
      { numRuns: 1_000 },
    );
  });

  it("a balanced reserve and release never leaves exposure", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10_000_000_000n }), (amount) => {
        const money = Money.fromMinorUnits("INR", amount);
        const operationId = purchaseOperationId("00000000-0000-4000-8000-000000000001");
        const exposure = calculateAuthorizationExposure("INR", [
          { operationId, type: "RESERVE", amount: money },
          { operationId, type: "RELEASE", amount: money },
        ]);
        expect(exposure.minorUnits).toBe(0n);
      }),
      { numRuns: 1_000 },
    );
  });

  it("unknown or drifted tools never become allowed for generated inputs", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("UNKNOWN" as const, "SCHEMA_DRIFT" as const),
        fc.boolean(),
        fc.boolean(),
        (status, inputValid, hasApproval) => {
          const decision = evaluateBoundaryPolicy({
            reconciliation: {
              toolName: "generated.tool",
              providerId: "generated",
              status,
              discoveredHash: "discovered",
              approvedHash: status === "SCHEMA_DRIFT" ? "old" : null,
              classification: "BINDING_WRITE",
            },
            trustState: "QUARANTINED",
            classification: "BINDING_WRITE",
            inputValid,
            humanApprovalId: hasApproval ? "approval" : null,
          });
          expect(decision.outcome).toBe("DENY");
        },
      ),
      { numRuns: 500 },
    );
  });
});
