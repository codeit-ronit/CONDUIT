export type MerchantRole = "OWNER" | "OPERATOR" | "VIEWER";

export interface MerchantCredential {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordSalt: string;
  readonly passwordDigest: string;
}

export interface MerchantSessionPrincipal {
  readonly sessionId: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly tenantId: string;
  readonly merchantId: string;
  readonly merchantName: string;
  readonly role: MerchantRole;
  readonly expiresAt: string;
}

export interface ProvisionMerchantUser {
  readonly email: string;
  readonly displayName: string;
  readonly passwordSalt: string;
  readonly passwordDigest: string;
  readonly tenantId: string;
  readonly merchantId: string;
  readonly role: MerchantRole;
}

export interface MerchantIdentityRepository {
  provisionUser(input: ProvisionMerchantUser): Promise<void>;
  findCredential(email: string): Promise<MerchantCredential | null>;
  createSession(input: {
    readonly userId: string;
    readonly tokenDigest: string;
    readonly expiresAt: Date;
  }): Promise<MerchantSessionPrincipal>;
  findActiveSession(tokenDigest: string): Promise<MerchantSessionPrincipal | null>;
  revokeSession(tokenDigest: string): Promise<void>;
}

export interface ProductProvenanceView {
  readonly fieldName: string;
  readonly sourceType: "CSV" | "XLSX" | "STOREFRONT";
  readonly sourceRef: string;
  readonly sourceDigest: string;
  readonly sourcePath: string;
  readonly observedValue: unknown;
  readonly recordedAt: string;
}

export interface MerchantProductView {
  readonly id: string;
  readonly sku: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly price: { readonly currency: string; readonly minorUnits: string };
  readonly priceVersion: number;
  readonly availableQuantity: number;
  readonly provenance: readonly ProductProvenanceView[];
}

export interface MerchantCatalogSnapshot {
  readonly merchant: {
    readonly id: string;
    readonly displayName: string;
    readonly currency: string;
  };
  readonly summary: {
    readonly productCount: number;
    readonly fieldsWithProvenance: number;
    readonly confirmedImports: number;
    readonly pendingEnrichments: number;
  };
  readonly products: readonly MerchantProductView[];
}

export interface MerchantCatalogRepository {
  loadCatalog(tenantId: string, merchantId: string): Promise<MerchantCatalogSnapshot>;
}
