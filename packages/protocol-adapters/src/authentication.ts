import { createHash, timingSafeEqual } from "node:crypto";

import type { UcpApiKeyCredential, UcpPrincipal, UcpRequestIdentity } from "./types.js";

export class UcpAuthenticationError extends Error {
  public readonly code = "UNAUTHORIZED";

  public constructor(message = "UCP request is not authenticated") {
    super(message);
    this.name = "UcpAuthenticationError";
  }
}

export function digestApiKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function authenticateUcpApiKey(
  request: UcpRequestIdentity,
  credentials: readonly UcpApiKeyCredential[],
): UcpPrincipal {
  const secret = bearerSecret(request.authorization);
  if (!secret || !request.ucpAgent) throw new UcpAuthenticationError();

  const suppliedDigest = Buffer.from(digestApiKey(secret), "hex");
  const credential = credentials.find((candidate) => {
    const storedDigest = Buffer.from(candidate.secretDigest, "hex");
    return (
      candidate.enabled &&
      storedDigest.length === suppliedDigest.length &&
      timingSafeEqual(storedDigest, suppliedDigest)
    );
  });

  if (credential?.agentProfile !== request.ucpAgent) {
    throw new UcpAuthenticationError(
      "Credential and UCP-Agent profile do not identify the same principal",
    );
  }

  return {
    principalId: credential.principalId,
    tenantId: credential.tenantId,
    merchantId: credential.merchantId,
    agentProfile: credential.agentProfile,
  };
}

function bearerSecret(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const secret = authorization.slice("Bearer ".length);
  return secret.length >= 24 ? secret : undefined;
}
