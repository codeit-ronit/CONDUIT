import { Money } from "@conduit/domain";
import { describe, expect, it, vi } from "vitest";

import {
  UCP_CATALOG_SEARCH,
  UCP_VERSION,
  UcpAuthenticationError,
  UcpNegotiationError,
  authenticateUcpApiKey,
  createUcpBusinessProfile,
  digestApiKey,
  negotiateUcpProfiles,
  searchUcpCatalog,
} from "../src/index.js";
import type { UcpApiKeyCredential, UcpProfile } from "../src/index.js";

const secret = "conduit_test_key_that_is_long_enough";
const credential: UcpApiKeyCredential = {
  keyId: "key-1",
  secretDigest: digestApiKey(secret),
  enabled: true,
  principalId: "platform-1",
  tenantId: "tenant-1",
  merchantId: "merchant-1",
  agentProfile: "https://agent.example/.well-known/ucp",
};

describe("UCP adapter boundary", () => {
  it("publishes only the capability this slice implements", () => {
    const profile = createUcpBusinessProfile("https://merchant.example/path");
    expect(profile.ucp.version).toBe(UCP_VERSION);
    expect(Object.keys(profile.ucp.capabilities)).toEqual([UCP_CATALOG_SEARCH]);
    expect(profile.ucp.services["dev.ucp.shopping"]?.[0]?.endpoint).toBe(
      "https://merchant.example/api/ucp",
    );
  });

  it("binds the API key principal to the declared UCP-Agent profile", () => {
    expect(
      authenticateUcpApiKey(
        {
          authorization: `Bearer ${secret}`,
          ucpAgent: credential.agentProfile,
        },
        [credential],
      ),
    ).toMatchObject({ tenantId: "tenant-1", merchantId: "merchant-1" });

    expect(() =>
      authenticateUcpApiKey(
        {
          authorization: `Bearer ${secret}`,
          ucpAgent: "https://impostor.example/.well-known/ucp",
        },
        [credential],
      ),
    ).toThrow(UcpAuthenticationError);
  });

  it("requires exact protocol and capability versions", () => {
    const business = createUcpBusinessProfile("https://merchant.example");
    const platform = createPlatformProfile();
    expect(negotiateUcpProfiles(business, platform, [UCP_CATALOG_SEARCH])).toEqual({
      version: UCP_VERSION,
      capabilities: {
        [UCP_CATALOG_SEARCH]: [{ version: UCP_VERSION }],
      },
    });

    const incompatible = createPlatformProfile("2026-04-08");
    expect(() =>
      negotiateUcpProfiles(business, incompatible, [UCP_CATALOG_SEARCH]),
    ).toThrow(UcpNegotiationError);
  });

  it("reads only the authenticated merchant and maps authoritative money", async () => {
    const listProducts = vi.fn().mockResolvedValue([
      {
        id: "11111111-1111-4111-8111-111111111111",
        tenantId: "tenant-1",
        merchantId: "merchant-1",
        sku: "TEA-1",
        displayName: "Assam Tea",
        description: "Strong black tea",
        category: "tea",
        attributes: {},
        price: Money.fromMinorUnits("INR", 24900n),
        priceVersion: 3,
        availableQuantity: 8,
      },
    ]);
    const response = await searchUcpCatalog(
      { listProducts },
      credential,
      negotiateUcpProfiles(
        createUcpBusinessProfile("https://merchant.example"),
        createPlatformProfile(),
        [UCP_CATALOG_SEARCH],
      ),
      "tea",
    );

    expect(listProducts).toHaveBeenCalledWith("tenant-1", "merchant-1");
    expect(response.products).toMatchObject([
      {
        title: "Assam Tea",
        price_range: { min: { amount: 24900, currency: "INR" } },
      },
    ]);
  });
});

function createPlatformProfile(version = UCP_VERSION): UcpProfile {
  return {
    ucp: {
      version,
      services: {},
      capabilities: {
        [UCP_CATALOG_SEARCH]: [{ version }],
      },
      payment_handlers: {},
    },
  };
}
