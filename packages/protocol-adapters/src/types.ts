import type { CatalogProduct } from "@conduit/domain";

export type UcpCapabilityRegistry = Readonly<
  Record<string, readonly UcpCapabilityDeclaration[]>
>;

export interface UcpCapabilityDeclaration {
  readonly version: string;
  readonly spec?: string;
  readonly schema?: string;
}

export interface UcpProfile {
  readonly ucp: {
    readonly version: string;
    readonly services: Readonly<
      Record<
        string,
        readonly {
          readonly version: string;
          readonly spec: string;
          readonly transport: "rest";
          readonly endpoint: string;
          readonly schema: string;
        }[]
      >
    >;
    readonly capabilities: UcpCapabilityRegistry;
    readonly payment_handlers: Readonly<Record<string, readonly unknown[]>>;
  };
}

export interface UcpPrincipal {
  readonly principalId: string;
  readonly tenantId: string;
  readonly merchantId: string;
  readonly agentProfile: string;
}

export interface UcpApiKeyCredential extends UcpPrincipal {
  readonly keyId: string;
  readonly secretDigest: string;
  readonly enabled: boolean;
}

export interface UcpRequestIdentity {
  readonly authorization: string | undefined;
  readonly ucpAgent: string | undefined;
}

export interface UcpNegotiationResult {
  readonly version: string;
  readonly capabilities: UcpCapabilityRegistry;
}

export interface CatalogSource {
  listProducts(
    tenantId: string,
    merchantId: string,
  ): Promise<readonly CatalogProduct[]>;
}
