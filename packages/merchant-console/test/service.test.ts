import { describe, expect, it } from "vitest";

import {
  MerchantAuthenticationError,
  MerchantConsoleService,
  digestSessionToken,
} from "../src/index.js";
import type {
  MerchantCatalogRepository,
  MerchantCatalogSnapshot,
  MerchantCredential,
  MerchantIdentityRepository,
  MerchantSessionPrincipal,
  ProvisionMerchantUser,
} from "../src/index.js";

const snapshot: MerchantCatalogSnapshot = {
  merchant: { id: "merchant-a", displayName: "Merchant A", currency: "INR" },
  summary: {
    productCount: 0,
    fieldsWithProvenance: 0,
    confirmedImports: 0,
    pendingEnrichments: 0,
  },
  products: [],
};

describe("merchant console identity", () => {
  it("stores digests, derives scope from the session, and revokes logout", async () => {
    const identity = new MemoryIdentity();
    const catalog = new MemoryCatalog();
    const service = new MerchantConsoleService(identity, catalog);
    await service.provisionLocalUser({
      email: " Owner@Example.COM ",
      displayName: "Owner",
      password: "correct horse battery staple",
      tenantId: "tenant-a",
      merchantId: "merchant-a",
      role: "OWNER",
    });

    await expect(service.login("owner@example.com", "no")).rejects.toBeInstanceOf(
      MerchantAuthenticationError,
    );
    const login = await service.login(
      "owner@example.com",
      "correct horse battery staple",
    );

    expect(identity.credential?.passwordDigest).not.toContain("correct horse");
    expect(identity.storedTokenDigest).toBe(digestSessionToken(login.token));
    expect(identity.storedTokenDigest).not.toBe(login.token);

    const response = await service.catalogFor(login.token);
    expect(response.principal).toMatchObject({
      tenantId: "tenant-a",
      merchantId: "merchant-a",
    });
    expect(catalog.lastScope).toEqual(["tenant-a", "merchant-a"]);

    await service.logout(login.token);
    await expect(service.authenticate(login.token)).rejects.toBeInstanceOf(
      MerchantAuthenticationError,
    );
  });
});

class MemoryIdentity implements MerchantIdentityRepository {
  public credential: MerchantCredential | null = null;
  public storedTokenDigest: string | null = null;
  private revoked = false;

  public provisionUser(input: ProvisionMerchantUser): Promise<void> {
    this.credential = {
      userId: "user-a",
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName,
      passwordSalt: input.passwordSalt,
      passwordDigest: input.passwordDigest,
    };
    return Promise.resolve();
  }

  public findCredential(email: string): Promise<MerchantCredential | null> {
    return Promise.resolve(this.credential?.email === email ? this.credential : null);
  }

  public createSession(input: {
    readonly userId: string;
    readonly tokenDigest: string;
    readonly expiresAt: Date;
  }): Promise<MerchantSessionPrincipal> {
    this.storedTokenDigest = input.tokenDigest;
    this.revoked = false;
    return Promise.resolve(principal(input.expiresAt));
  }

  public findActiveSession(
    tokenDigest: string,
  ): Promise<MerchantSessionPrincipal | null> {
    return Promise.resolve(
      !this.revoked && tokenDigest === this.storedTokenDigest
        ? principal(new Date(Date.now() + 60_000))
        : null,
    );
  }

  public revokeSession(tokenDigest: string): Promise<void> {
    if (tokenDigest === this.storedTokenDigest) this.revoked = true;
    return Promise.resolve();
  }
}

class MemoryCatalog implements MerchantCatalogRepository {
  public lastScope: readonly string[] | null = null;

  public loadCatalog(
    tenantId: string,
    merchantId: string,
  ): Promise<MerchantCatalogSnapshot> {
    this.lastScope = [tenantId, merchantId];
    return Promise.resolve(snapshot);
  }
}

function principal(expiresAt: Date): MerchantSessionPrincipal {
  return {
    sessionId: "session-a",
    userId: "user-a",
    email: "owner@example.com",
    displayName: "Owner",
    tenantId: "tenant-a",
    merchantId: "merchant-a",
    merchantName: "Merchant A",
    role: "OWNER",
    expiresAt: expiresAt.toISOString(),
  };
}
