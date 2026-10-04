import type { Pool } from "@conduit/infrastructure";

import { runAgentScenario } from "./agent-scenarios.js";

export const journeyScenarioNames = ["buyer-purchase"] as const;
export type JourneyScenarioName = (typeof journeyScenarioNames)[number];

export async function runJourneyScenario(pool: Pool, name: JourneyScenarioName) {
  const agent = await runAgentScenario(pool, "scripted");
  const run = agent.run;
  if (
    run?.state !== "SUCCEEDED" ||
    !run.cart ||
    run.commit?.outcome !== "CONFIRMED" ||
    !agent.audit
  ) {
    throw new Error("The buyer journey did not reach its expected safe terminal state");
  }
  const receipt = record(run.commit.evidence);
  return {
    phase: 7,
    surface: "BUYER_JOURNEY",
    scenario: name,
    title: "A purchase you can explain from start to finish",
    lesson:
      "The AI proposes and chooses, while typed confirmation, server pricing, policy, and the provider boundary control every irreversible step.",
    claimLevel: "MIXED_EXPLICIT",
    stages: [
      {
        key: "AUTHORIZATION",
        title: "1. Buyer authorizes exact constraints",
        claim: "SCRIPTED",
        status: agent.confirmed ? "COMPLETE" : "STOPPED",
        explanation:
          "The request becomes typed constraints and a fingerprint. The demo confirms that exact fingerprint before tools can run.",
        evidence: {
          fingerprint: agent.proposal?.fingerprint,
          maximumMinorUnits: agent.proposal?.proposal.maximumMinorUnits,
          currency: agent.proposal?.proposal.currency,
          allowedCategory: agent.proposal?.proposal.category,
          excludedTerms: agent.proposal?.proposal.excludedTerms,
        },
      },
      {
        key: "SELECTION",
        title: "2. AI selects only from valid candidates",
        claim: "SCRIPTED",
        status: "COMPLETE",
        explanation:
          "Code removes products that violate budget, stock, attributes, or exclusions before the model chooses.",
        evidence: {
          modelId: run.modelId,
          sku: run.cart.lines[0]?.sku,
          quantity: run.cart.lines[0]?.quantity,
          serverTotalMinorUnits: run.cart.totalMinorUnits,
        },
      },
      {
        key: "COMMIT",
        title: "3. Trusted commit rechecks everything",
        claim: "REAL_LOCAL_DATABASE",
        status: run.commit.outcome,
        explanation:
          "The PostgreSQL-backed gate reprices, checks authorization, reserves stock and spend, and records an idempotent operation.",
        evidence: {
          boundaryCalls: agent.boundaryCalls.length,
          auditVerified: agent.audit.verification.valid,
          chargedMinorUnits: run.commit.chargedMinorUnits,
        },
      },
      {
        key: "PAYMENT",
        title: "4. Provider processes the reserved amount",
        claim: "MODELLED",
        status:
          typeof receipt.providerStatus === "string"
            ? receipt.providerStatus
            : "UNKNOWN",
        explanation:
          "A deterministic local provider simulates authorization. No Razorpay or real bank network is called in this phase.",
        evidence: {
          providerReference: receipt.providerReference,
          externalMoneyMoved: false,
        },
      },
      {
        key: "RECEIPT",
        title: "5. Receipt links durable evidence",
        claim: "REAL_LOCAL_DATABASE",
        status: "ISSUED",
        explanation:
          "The receipt links the trusted operation, immutable order snapshot, modelled provider reference, and verified audit chain.",
        evidence: {
          operationId: receipt.operationId,
          orderId: receipt.orderId,
          providerReference: receipt.providerReference,
          auditHead: agent.audit.verification.headHash,
        },
      },
    ],
    totals: {
      currency: run.cart.currency,
      chargedMinorUnits: run.commit.chargedMinorUnits,
      realExternalCharge: false,
    },
    rawRun: agent,
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
