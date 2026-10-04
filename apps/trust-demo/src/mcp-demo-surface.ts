import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import {
  CommerceService,
  DeterministicModelledOrderProvider,
} from "@conduit/application";
import { PostgresCommerceRepository } from "@conduit/infrastructure";
import type { Pool } from "@conduit/infrastructure";
import {
  createUcpBusinessProfile,
  createUcpMcpCatalogHandler,
  digestApiKey,
  toLocalNodeMcpHandler,
} from "@conduit/protocol-adapters";
import type { UcpApiKeyCredential } from "@conduit/protocol-adapters";

const agentProfile = "https://buyer-agent.example/.well-known/ucp";

export async function createMcpDemoSurface(pool: Pool, baseUrl: string) {
  const commerce = new CommerceService(
    new PostgresCommerceRepository(pool),
    new DeterministicModelledOrderProvider(),
  );
  const suffix = crypto.randomUUID().slice(0, 8);
  const tenant = await commerce.createTenant({
    slug: `mcp-${suffix}`,
    displayName: "CONDUIT MCP Lab",
  });
  const merchant = await commerce.createMerchant({
    tenantId: tenant.id,
    slug: "tea-merchant",
    displayName: "MCP Tea Merchant",
    currency: "INR",
  });
  await commerce.createProduct({
    tenantId: tenant.id,
    merchantId: merchant.id,
    sku: "MCP-TEA-1",
    displayName: "MCP Assam Tea",
    description: "Merchant-authored tea description",
    category: "tea",
    attributes: { origin: "Assam" },
    price: { currency: "INR", minorUnits: "24900" },
    stock: 12,
  });

  const secret = `conduit_mcp_${crypto.randomUUID()}`;
  const credential: UcpApiKeyCredential = {
    keyId: "runtime-mcp-demo-key",
    secretDigest: digestApiKey(secret),
    enabled: true,
    principalId: "conduit-demo-buyer-agent",
    tenantId: tenant.id,
    merchantId: merchant.id,
    agentProfile,
  };
  let catalogReads = 0;
  const handler = createUcpMcpCatalogHandler({
    businessProfile: createUcpBusinessProfile(baseUrl),
    credentials: [credential],
    catalog: {
      listProducts: (tenantId, merchantId) => {
        catalogReads += 1;
        return commerce.listProducts(tenantId, merchantId);
      },
    },
  });
  const nodeHandler = toLocalNodeMcpHandler(handler);

  return {
    handleNode: nodeHandler,
    close: handler.close,
    async runRoundTrip() {
      const readsBefore = catalogReads;
      const client = new Client(
        { name: "conduit-visual-demo-client", version: "0.1.0" },
        { versionNegotiation: { mode: { pin: "2026-07-28" } } },
      );
      const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
        authProvider: { token: () => Promise.resolve(secret) },
        fetch: (input, init) => handler.fetch(new Request(input, init)),
      });
      try {
        await client.connect(transport);
        const tools = await client.listTools();
        const result = await client.callTool({
          name: "search_catalog",
          arguments: {
            meta: { "ucp-agent": { profile: agentProfile } },
            catalog: { query: "tea" },
          },
        });
        return {
          phase: 7,
          surface: "MCP_CATALOG",
          scenario: "mcp-roundtrip",
          title: "Official MCP client to scoped UCP catalog",
          lesson:
            "MCP transports the tool call; CONDUIT authentication and merchant scope still decide what data it can reach.",
          claimLevel: "REAL_LOCAL_DATABASE",
          transport: {
            protocol: "MCP",
            negotiatedEra: client.getProtocolEra(),
            sdk: "@modelcontextprotocol/client + server 2.3.0",
            toolNames: tools.tools.map((tool) => tool.name),
          },
          request: {
            tool: "search_catalog",
            meta: { "ucp-agent": { profile: agentProfile } },
            catalog: { query: "tea" },
            bearerSecretReturnedToBrowser: false,
          },
          response: result.structuredContent,
          catalogReads: catalogReads - readsBefore,
          conformance: "PARTIAL_NOT_CLAIMED",
        };
      } finally {
        await client.close();
      }
    },
  };
}
