import type { IncomingMessage, ServerResponse } from "node:http";

import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import {
  McpServer,
  ProtocolError,
  createMcpHandler,
} from "@modelcontextprotocol/server";
import type { AuthInfo, McpHttpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  UcpAuthenticationError,
  authenticateUcpBearer,
  bindUcpAgent,
} from "./authentication.js";
import { searchUcpCatalog } from "./catalog.js";
import { UcpNegotiationError, negotiateUcpProfiles } from "./negotiation.js";
import type {
  CatalogSource,
  UcpApiKeyCredential,
  UcpPrincipal,
  UcpProfile,
} from "./types.js";
import { UCP_CATALOG_SEARCH, UCP_VERSION } from "./ucp-profile.js";

const searchInputSchema = z
  .object({
    meta: z
      .object({
        "ucp-agent": z.object({ profile: z.url() }).strict(),
      })
      .strict(),
    catalog: z.object({ query: z.string().trim().min(1).max(500) }).strict(),
  })
  .strict();

export interface UcpMcpCatalogOptions {
  readonly businessProfile: UcpProfile;
  readonly credentials: readonly UcpApiKeyCredential[];
  readonly catalog: CatalogSource;
}

export interface UcpMcpCatalogHandler {
  readonly fetch: McpHttpHandler["fetch"];
  readonly close: McpHttpHandler["close"];
}

export function createUcpMcpCatalogHandler(
  options: UcpMcpCatalogOptions,
): UcpMcpCatalogHandler {
  const handler = createMcpHandler(
    ({ authInfo }) => createCatalogServer(options, principalFrom(authInfo)),
    { responseMode: "json", legacy: "reject" },
  );

  return {
    fetch: async (request, requestOptions) => {
      let credential: UcpApiKeyCredential;
      try {
        credential = authenticateUcpBearer(
          request.headers.get("authorization") ?? undefined,
          options.credentials,
        );
      } catch (error: unknown) {
        if (!(error instanceof UcpAuthenticationError)) throw error;
        return new Response(null, {
          status: 401,
          headers: { "www-authenticate": 'Bearer realm="conduit-mcp"' },
        });
      }
      const authInfo: AuthInfo = {
        token: request.headers.get("authorization") ?? "",
        clientId: credential.principalId,
        scopes: ["catalog:read"],
        extra: {
          tenantId: credential.tenantId,
          merchantId: credential.merchantId,
          agentProfile: credential.agentProfile,
        },
      };
      return handler.fetch(request, { ...requestOptions, authInfo });
    },
    close: handler.close,
  };
}

export function toLocalNodeMcpHandler(handler: UcpMcpCatalogHandler) {
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  const nodeHandler = toNodeHandler(handler);
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (!validateHost(request, response) || !validateOrigin(request, response)) return;
    if (!request.method || !request.url) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end('{"error":"Malformed HTTP request"}');
      return;
    }
    await nodeHandler(
      request as IncomingMessage & { method: string; url: string },
      response,
    );
  };
}

function createCatalogServer(
  options: UcpMcpCatalogOptions,
  authenticatedPrincipal: UcpPrincipal,
): McpServer {
  const server = new McpServer({ name: "conduit-ucp-catalog", version: "0.1.0" });
  server.registerTool(
    "search_catalog",
    {
      title: "Search merchant catalog",
      description:
        "Search the authenticated merchant scope using the UCP catalog contract.",
      inputSchema: searchInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ meta, catalog }) => {
      try {
        const principal = bindUcpAgent(
          authenticatedPrincipal,
          meta["ucp-agent"].profile,
        );
        const negotiation = negotiateUcpProfiles(
          options.businessProfile,
          platformProfile(),
          [UCP_CATALOG_SEARCH],
        );
        const result = await searchUcpCatalog(
          options.catalog,
          principal,
          negotiation,
          catalog.query,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error: unknown) {
        if (error instanceof UcpAuthenticationError) {
          throw new ProtocolError(-32000, "Unauthorized");
        }
        if (error instanceof UcpNegotiationError) {
          throw new ProtocolError(-32001, error.message, { code: error.code });
        }
        throw error;
      }
    },
  );
  return server;
}

function principalFrom(authInfo: AuthInfo | undefined): UcpPrincipal {
  const extra = authInfo?.extra;
  if (
    !authInfo ||
    typeof extra?.tenantId !== "string" ||
    typeof extra.merchantId !== "string" ||
    typeof extra.agentProfile !== "string"
  ) {
    throw new UcpAuthenticationError();
  }
  return {
    principalId: authInfo.clientId,
    tenantId: extra.tenantId,
    merchantId: extra.merchantId,
    agentProfile: extra.agentProfile,
  };
}

function platformProfile(): UcpProfile {
  return {
    ucp: {
      version: UCP_VERSION,
      services: {},
      capabilities: {
        [UCP_CATALOG_SEARCH]: [{ version: UCP_VERSION }],
      },
      payment_handlers: {},
    },
  };
}
