import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Money, merchantId, productId, tenantId } from "@conduit/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  UCP_VERSION,
  createUcpBusinessProfile,
  createUcpMcpCatalogHandler,
  digestApiKey,
} from "../src/index.js";
import type {
  CatalogSource,
  UcpApiKeyCredential,
  UcpMcpCatalogHandler,
} from "../src/index.js";

const secret = "conduit_mcp_test_key_that_is_long_enough";
const agentProfile = "https://buyer-agent.example/.well-known/ucp";
const testTenantId = tenantId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const testMerchantId = merchantId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const credential: UcpApiKeyCredential = {
  keyId: "mcp-test-key",
  secretDigest: digestApiKey(secret),
  enabled: true,
  principalId: "buyer-agent",
  tenantId: testTenantId,
  merchantId: testMerchantId,
  agentProfile,
};

const openHandlers: UcpMcpCatalogHandler[] = [];

afterEach(async () => {
  await Promise.all(openHandlers.splice(0).map((handler) => handler.close()));
});

describe("authenticated UCP over MCP", () => {
  it("serves search_catalog through the official modern MCP client", async () => {
    const listProducts = vi.fn<CatalogSource["listProducts"]>().mockResolvedValue([
      {
        id: productId("11111111-1111-4111-8111-111111111111"),
        tenantId: testTenantId,
        merchantId: testMerchantId,
        sku: "TEA-1",
        displayName: "Assam Tea",
        description: "Strong black tea",
        category: "tea",
        attributes: {},
        price: Money.fromMinorUnits("INR", 24900n),
        priceVersion: 1,
        availableQuantity: 8,
      },
    ]);
    const handler = createHandler(listProducts);
    const client = await connectClient(handler, secret);
    const tools = await client.listTools();
    const result = await client.callTool({
      name: "search_catalog",
      arguments: {
        meta: { "ucp-agent": { profile: agentProfile } },
        catalog: { query: "tea" },
      },
    });
    await client.close();

    expect(tools.tools.map((tool) => tool.name)).toEqual(["search_catalog"]);
    expect(result.structuredContent).toMatchObject({
      ucp: { version: UCP_VERSION },
      products: [{ title: "Assam Tea" }],
    });
    expect(listProducts).toHaveBeenCalledWith(testTenantId, testMerchantId);
  });

  it("returns HTTP 401 before MCP dispatch for a bad bearer token", async () => {
    const handler = createHandler(vi.fn<CatalogSource["listProducts"]>());
    const response = await handler.fetch(
      new Request("http://127.0.0.1:4310/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer invalid_key_that_is_long_enough",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("rejects a valid key claiming a different UCP agent", async () => {
    const listProducts = vi.fn<CatalogSource["listProducts"]>();
    const handler = createHandler(listProducts);
    const client = await connectClient(handler, secret);
    const result = await client.callTool({
      name: "search_catalog",
      arguments: {
        meta: {
          "ucp-agent": {
            profile: "https://impostor.example/.well-known/ucp",
          },
        },
        catalog: { query: "tea" },
      },
    });
    await client.close();
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Unauthorized" }],
    });
    expect(listProducts).not.toHaveBeenCalled();
  });
});

function createHandler(listProducts: CatalogSource["listProducts"]) {
  const handler = createUcpMcpCatalogHandler({
    businessProfile: createUcpBusinessProfile("http://127.0.0.1:4310"),
    credentials: [credential],
    catalog: { listProducts },
  });
  openHandlers.push(handler);
  return handler;
}

async function connectClient(handler: UcpMcpCatalogHandler, key: string) {
  const client = new Client(
    { name: "conduit-mcp-test-client", version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StreamableHTTPClientTransport(
    new URL("http://127.0.0.1:4310/mcp"),
    {
      authProvider: { token: () => Promise.resolve(key) },
      fetch: (input, init) => handler.fetch(new Request(input, init)),
    },
  );
  await client.connect(transport);
  return client;
}
