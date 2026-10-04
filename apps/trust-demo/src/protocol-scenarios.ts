import {
  CommerceService,
  DeterministicModelledOrderProvider,
} from "@conduit/application";
import { PostgresCommerceRepository } from "@conduit/infrastructure";
import type { Pool } from "@conduit/infrastructure";
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
} from "@conduit/protocol-adapters";
import type {
  CatalogSource,
  UcpApiKeyCredential,
  UcpProfile,
} from "@conduit/protocol-adapters";

export const protocolScenarioNames = [
  "profile-discovery",
  "authenticated-catalog",
  "identity-mismatch",
  "capability-mismatch",
] as const;
export type ProtocolScenarioName = (typeof protocolScenarioNames)[number];

const agentProfile = "https://buyer-agent.example/.well-known/ucp";

export async function runProtocolScenario(pool: Pool, name: ProtocolScenarioName) {
  const businessProfile = createUcpBusinessProfile("http://127.0.0.1:4310");
  if (name === "profile-discovery") {
    return response(name, {
      claimLevel: "REFERENCED",
      businessProfile,
      implementation: {
        pinnedRelease: UCP_VERSION,
        conformance: "NOT_CLAIMED",
        reason:
          "This local HTTP demonstration implements one protocol slice; production hosting and the official conformance suite are not complete.",
      },
    });
  }

  const commerce = new CommerceService(
    new PostgresCommerceRepository(pool),
    new DeterministicModelledOrderProvider(),
  );
  const suffix = crypto.randomUUID().slice(0, 8);
  const tenant = await commerce.createTenant({
    slug: `protocol-${suffix}`,
    displayName: "CONDUIT Protocol Lab",
  });
  const merchant = await commerce.createMerchant({
    tenantId: tenant.id,
    slug: "merchant",
    displayName: "Protocol Demo Merchant",
    currency: "INR",
  });
  await commerce.createProduct({
    tenantId: tenant.id,
    merchantId: merchant.id,
    sku: "TEA-ASSAM-1",
    displayName: "Assam Breakfast Tea",
    description: "Merchant-authored product description",
    category: "tea",
    attributes: { origin: "Assam", caffeinated: true },
    price: { currency: "INR", minorUnits: "24900" },
    stock: 8,
  });

  const secret = `conduit_demo_${crypto.randomUUID()}`;
  const credential: UcpApiKeyCredential = {
    keyId: "demo-platform-key",
    secretDigest: digestApiKey(secret),
    enabled: true,
    principalId: "demo-buyer-agent",
    tenantId: tenant.id,
    merchantId: merchant.id,
    agentProfile,
  };
  let catalogReads = 0;
  const source: CatalogSource = {
    listProducts: (tenantId, merchantId) => {
      catalogReads += 1;
      return commerce.listProducts(tenantId, merchantId);
    },
  };

  try {
    const principal = authenticateUcpApiKey(
      {
        authorization: `Bearer ${secret}`,
        ucpAgent:
          name === "identity-mismatch"
            ? "https://impostor.example/.well-known/ucp"
            : agentProfile,
      },
      [credential],
    );
    const platformProfile = createPlatformProfile(
      name === "capability-mismatch" ? "2026-04-08" : UCP_VERSION,
    );
    const negotiation = negotiateUcpProfiles(businessProfile, platformProfile, [
      UCP_CATALOG_SEARCH,
    ]);
    const catalog = await searchUcpCatalog(source, principal, negotiation, "tea");
    return response(name, {
      claimLevel: "REAL_LOCAL_DATABASE",
      authentication: {
        mechanism: "API_KEY",
        identityBinding: "MATCHED",
        secretReturnedToBrowser: false,
        principal: {
          principalId: principal.principalId,
          tenantId: principal.tenantId,
          merchantId: principal.merchantId,
          agentProfile: principal.agentProfile,
        },
      },
      negotiation,
      catalog,
      catalogReads,
      implementation: {
        pinnedRelease: UCP_VERSION,
        conformance: "NOT_CLAIMED",
      },
    });
  } catch (error: unknown) {
    if (
      !(error instanceof UcpAuthenticationError) &&
      !(error instanceof UcpNegotiationError)
    ) {
      throw error;
    }
    return response(name, {
      claimLevel: "MODELLED",
      blocked: true,
      failure: {
        code: error instanceof UcpNegotiationError ? error.code : error.code,
        message: error.message,
        stage:
          error instanceof UcpAuthenticationError
            ? "AUTHENTICATE_AND_BIND_IDENTITY"
            : "NEGOTIATE_EXACT_VERSIONS",
      },
      catalogReads,
      implementation: {
        pinnedRelease: UCP_VERSION,
        conformance: "NOT_CLAIMED",
      },
    });
  }
}

function createPlatformProfile(version: string): UcpProfile {
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

function response(name: ProtocolScenarioName, detail: Record<string, unknown>) {
  return {
    phase: 7,
    scenario: name,
    title: titles[name],
    lesson: lessons[name],
    ...detail,
  };
}

const titles: Record<ProtocolScenarioName, string> = {
  "profile-discovery": "Discover only what is implemented",
  "authenticated-catalog": "Authenticated catalog search",
  "identity-mismatch": "Impersonated agent profile blocked",
  "capability-mismatch": "Incompatible protocol version blocked",
};

const lessons: Record<ProtocolScenarioName, string> = {
  "profile-discovery":
    "The machine-readable profile advertises only catalog search, not checkout or payment behavior that this slice has not implemented.",
  "authenticated-catalog":
    "The API key is bound to one agent profile and one tenant/merchant scope before real PostgreSQL catalog data is projected into the UCP catalog shape.",
  "identity-mismatch":
    "A valid secret cannot be reused with another UCP-Agent identity; the request is rejected before any merchant data is read.",
  "capability-mismatch":
    "Versions are matched exactly. An older platform profile cannot silently use a newer business contract.",
};
