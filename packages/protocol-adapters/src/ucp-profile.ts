import type { UcpProfile } from "./types.js";

export const UCP_VERSION = "2026-08-25";
export const UCP_CATALOG_SEARCH = "dev.ucp.shopping.catalog.search";

export function createUcpBusinessProfile(baseUrl: string): UcpProfile {
  const origin = new URL(baseUrl).origin;
  return {
    ucp: {
      version: UCP_VERSION,
      services: {
        "dev.ucp.shopping": [
          {
            version: UCP_VERSION,
            spec: `https://ucp.dev/${UCP_VERSION}/specification/overview/`,
            transport: "rest",
            endpoint: `${origin}/api/ucp`,
            schema: `https://ucp.dev/${UCP_VERSION}/services/shopping/rest.openapi.json`,
          },
        ],
      },
      capabilities: {
        [UCP_CATALOG_SEARCH]: [
          {
            version: UCP_VERSION,
            spec: `https://ucp.dev/${UCP_VERSION}/specification/shopping/catalog/search/`,
            schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/catalog_search.json`,
          },
        ],
      },
      payment_handlers: {},
    },
  };
}
