import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

import type {
  MerchantCatalogRepository,
  MerchantIdentityRepository,
  MerchantSessionPrincipal,
  ProvisionMerchantUser,
} from "./types.js";

const scrypt = promisify(scryptCallback);
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

export class MerchantAuthenticationError extends Error {
  public readonly code = "MERCHANT_AUTHENTICATION_FAILED";

  public constructor(message = "Merchant credentials or session are invalid") {
    super(message);
    this.name = "MerchantAuthenticationError";
  }
}

export class MerchantConsoleService {
  public constructor(
    private readonly identity: MerchantIdentityRepository,
    private readonly catalog: MerchantCatalogRepository,
  ) {}

  public async provisionLocalUser(
    input: Omit<ProvisionMerchantUser, "passwordSalt" | "passwordDigest"> & {
      readonly password: string;
    },
  ): Promise<void> {
    validatePassword(input.password);
    const email = normalizeEmail(input.email);
    const existing = await this.identity.findCredential(email);
    let passwordSalt = existing?.passwordSalt ?? randomBytes(16).toString("hex");
    let passwordDigest = await derivePassword(input.password, passwordSalt);
    if (existing && !safeDigestEqual(passwordDigest, existing.passwordDigest)) {
      passwordSalt = randomBytes(16).toString("hex");
      passwordDigest = await derivePassword(input.password, passwordSalt);
    }
    await this.identity.provisionUser({
      ...input,
      email,
      passwordSalt,
      passwordDigest,
    });
  }

  public async login(
    emailInput: string,
    password: string,
  ): Promise<{ readonly token: string; readonly principal: MerchantSessionPrincipal }> {
    const email = normalizeEmail(emailInput);
    const credential = await this.identity.findCredential(email);
    const passwordSalt = credential?.passwordSalt ?? "0".repeat(32);
    const passwordIsPlausible = password.length >= 12 && password.length <= 256;
    const supplied = Buffer.from(
      await derivePassword(
        passwordIsPlausible ? password : "invalid-login-password",
        passwordSalt,
      ),
      "hex",
    );
    const stored = Buffer.from(credential?.passwordDigest ?? "0".repeat(64), "hex");
    if (
      !credential ||
      !passwordIsPlausible ||
      supplied.length !== stored.length ||
      !timingSafeEqual(supplied, stored)
    ) {
      throw new MerchantAuthenticationError();
    }
    const token = randomBytes(32).toString("base64url");
    const principal = await this.identity.createSession({
      userId: credential.userId,
      tokenDigest: digestSessionToken(token),
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    });
    return { token, principal };
  }

  public async authenticate(
    token: string | undefined,
  ): Promise<MerchantSessionPrincipal> {
    if (!token || token.length < 32) throw new MerchantAuthenticationError();
    const principal = await this.identity.findActiveSession(digestSessionToken(token));
    if (!principal) throw new MerchantAuthenticationError();
    return principal;
  }

  public async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.identity.revokeSession(digestSessionToken(token));
  }

  public async catalogFor(token: string | undefined) {
    const principal = await this.authenticate(token);
    const catalog = await this.catalog.loadCatalog(
      principal.tenantId,
      principal.merchantId,
    );
    return { principal, catalog };
  }
}

export function digestSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 320 || !email.includes("@")) {
    throw new MerchantAuthenticationError();
  }
  return email;
}

function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 256) {
    throw new Error("Merchant password must contain between 12 and 256 characters");
  }
}

async function derivePassword(password: string, salt: string): Promise<string> {
  const digest = (await scrypt(password, salt, 32)) as Buffer;
  return digest.toString("hex");
}

function safeDigestEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return (
    leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
  );
}
