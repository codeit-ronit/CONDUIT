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
  if (!request.ucpAgent) throw new UcpAuthenticationError();
  return bindUcpAgent(
    authenticateUcpBearer(request.authorization, credentials),
    request.ucpAgent,
  );
}

export function authenticateUcpBearer(
  authorization: string | undefined,
  credentials: readonly UcpApiKeyCredential[],
): UcpApiKeyCredential {
  const secret = bearerSecret(authorization);
  if (!secret) throw new UcpAuthenticationError();

  const suppliedDigest = Buffer.from(digestApiKey(secret), "hex");
  const credential = credentials.find((candidate) => {
    const storedDigest = Buffer.from(candidate.secretDigest, "hex");
    return (
      candidate.enabled &&
      storedDigest.length === suppliedDigest.length &&
      timingSafeEqual(storedDigest, suppliedDigest)
    );
  });

  if (!credential) throw new UcpAuthenticationError();
  return credential;
}

export function bindUcpAgent(credential: UcpPrincipal, ucpAgent: string): UcpPrincipal {
  const declaredProfile = parseUcpAgentProfile(ucpAgent);
  if (credential.agentProfile !== declaredProfile) {
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

/** REST uses an RFC 8941 dictionary; MCP metadata carries the profile value directly. */
export function parseUcpAgentProfile(value: string): string {
  if (value.startsWith("https://")) return value;
  const match = /^profile="(https:\/\/[^"\\]+)"$/u.exec(value.trim());
  if (!match?.[1]) {
    throw new UcpAuthenticationError("UCP-Agent is not a valid profile field");
  }
  return match[1];
}

function bearerSecret(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const secret = authorization.slice("Bearer ".length);
  return secret.length >= 24 ? secret : undefined;
}
