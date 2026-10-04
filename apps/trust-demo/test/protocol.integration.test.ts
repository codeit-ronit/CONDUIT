import { afterAll, describe, expect, it } from "vitest";

import { createDatabasePool } from "@conduit/infrastructure";

import { runJourneyScenario } from "../src/journey-scenarios.js";
import { createMcpDemoSurface } from "../src/mcp-demo-surface.js";
import { runProtocolScenario } from "../src/protocol-scenarios.js";
import { createUcpShoppingDemoSurface } from "../src/ucp-shopping-surface.js";

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

  it("runs an official MCP client through the authenticated catalog handler", async () => {
    const surface = await createMcpDemoSurface(pool, "http://127.0.0.1:4310");
    try {
      expect(await surface.runRoundTrip()).toMatchObject({
        surface: "MCP_CATALOG",
        claimLevel: "REAL_LOCAL_DATABASE",
        transport: {
          protocol: "MCP",
          negotiatedEra: "modern",
          toolNames: ["search_catalog"],
        },
        request: { bearerSecretReturnedToBrowser: false },
        response: {
          products: [{ title: "MCP Assam Tea" }],
        },
        catalogReads: 1,
        conformance: "PARTIAL_NOT_CLAIMED",
      });
    } finally {
      await surface.close();
    }
  });

  it("keeps UCP checkout behind trusted buyer review and caches matching retries", async () => {
    const surface = await createUcpShoppingDemoSurface(pool, "http://127.0.0.1:4310");
    const result = await surface.runRoundTrip();

    expect(result).toMatchObject({
      surface: "UCP_CART_CHECKOUT",
      protocol: {
        version: "2026-08-25",
        capabilities: ["dev.ucp.shopping.cart", "dev.ucp.shopping.checkout"],
      },
      stages: {
        cart: { status: 201, body: { currency: "INR" } },
        idempotentReplay: { status: 201, replayed: true },
        mismatchedReplay: {
          status: 409,
          body: { code: "idempotency_key_reused" },
        },
        checkout: {
          status: 201,
          body: { status: "requires_escalation" },
        },
        agentCompleteBeforeReview: {
          body: { status: "requires_escalation" },
        },
        trustedUiApproval: { body: { status: "completed" } },
        concurrentApprovalReplay: { body: { status: "completed" } },
        finalCheckout: { body: { status: "completed" } },
      },
      claims: {
        databaseAndTrustChecks: "REAL_LOCAL_DATABASE",
        paymentProvider: "MODELLED_NO_EXTERNAL_MONEY",
        publicUcpConformance: "NOT_CLAIMED",
        bearerSecretReturnedToBrowser: false,
      },
      receipt: {
        schemaVersion: "conduit.order-evidence.v1",
        claims: {
          commerceState: "TESTED",
          payment: "MODELLED",
          auditLink: "NOT_LINKED",
        },
        operation: { status: "CONFIRMED" },
        providerDelivery: { status: "DELIVERED", attempts: 1 },
        timeline: [
          { type: "ORDER_PREPARED" },
          { type: "SPEND_RESERVED" },
          { type: "PROVIDER_QUEUED" },
          { type: "PROVIDER_ATTEMPTED" },
          { type: "PAYMENT_CONFIRMED" },
        ],
      },
    });
  });

  it("links the complete buyer journey to durable commit evidence", async () => {
    expect(await runJourneyScenario(pool, "buyer-purchase")).toMatchObject({
      surface: "BUYER_JOURNEY",
      claimLevel: "MIXED_EXPLICIT",
      stages: [
        { key: "AUTHORIZATION", claim: "SCRIPTED", status: "COMPLETE" },
        { key: "SELECTION", claim: "SCRIPTED", status: "COMPLETE" },
        { key: "COMMIT", claim: "REAL_LOCAL_DATABASE", status: "CONFIRMED" },
        { key: "PAYMENT", claim: "MODELLED", evidence: { externalMoneyMoved: false } },
        {
          key: "RECEIPT",
          claim: "REAL_LOCAL_DATABASE",
          evidence: {
            operationId: expect.any(String),
            orderId: expect.any(String),
            providerReference: expect.any(String),
            auditHead: expect.any(String),
          },
        },
      ],
      totals: {
        currency: "INR",
        chargedMinorUnits: "39800",
        realExternalCharge: false,
      },
    });
  });
});
