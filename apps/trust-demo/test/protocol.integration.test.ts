import { afterAll, describe, expect, it } from "vitest";

import { createDatabasePool } from "@conduit/infrastructure";

import { runProtocolScenario } from "../src/protocol-scenarios.js";

const pool = createDatabasePool();

afterAll(async () => {
  await pool.end();
});

describe("Phase 7 UCP protocol slice", () => {
  it("projects a credential-scoped PostgreSQL catalog", async () => {
    expect(await runProtocolScenario(pool, "authenticated-catalog")).toMatchObject({
      phase: 7,
      claimLevel: "REAL_LOCAL_DATABASE",
      authentication: {
        identityBinding: "MATCHED",
        secretReturnedToBrowser: false,
      },
      catalogReads: 1,
      catalog: {
        products: [
          {
            title: "Assam Breakfast Tea",
            price_range: { min: { amount: 24900, currency: "INR" } },
          },
        ],
      },
    });
  });

  it.each([
    ["identity-mismatch", "AUTHENTICATE_AND_BIND_IDENTITY", "UNAUTHORIZED"],
    ["capability-mismatch", "NEGOTIATE_EXACT_VERSIONS", "version_unsupported"],
  ] as const)("blocks %s before any catalog read", async (scenario, stage, code) => {
    expect(await runProtocolScenario(pool, scenario)).toMatchObject({
      blocked: true,
      catalogReads: 0,
      failure: { stage, code },
    });
  });
});
