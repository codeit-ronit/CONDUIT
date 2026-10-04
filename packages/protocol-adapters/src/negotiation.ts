import type { UcpNegotiationResult, UcpProfile } from "./types.js";

export class UcpNegotiationError extends Error {
  public constructor(
    public readonly code: "version_unsupported" | "capabilities_incompatible",
    message: string,
  ) {
    super(message);
    this.name = "UcpNegotiationError";
  }
}

export function negotiateUcpProfiles(
  business: UcpProfile,
  platform: UcpProfile,
  requiredCapabilities: readonly string[],
): UcpNegotiationResult {
  if (business.ucp.version !== platform.ucp.version) {
    throw new UcpNegotiationError(
      "version_unsupported",
      `Platform version ${platform.ucp.version} does not match business version ${business.ucp.version}`,
    );
  }

  const capabilities: Record<string, readonly { version: string }[]> = {};
  for (const name of requiredCapabilities) {
    const businessVersions = business.ucp.capabilities[name] ?? [];
    const platformVersions = new Set(
      (platform.ucp.capabilities[name] ?? []).map((entry) => entry.version),
    );
    const shared = businessVersions
      .filter((entry) => platformVersions.has(entry.version))
      .toSorted((left, right) => right.version.localeCompare(left.version));
    const selected = shared[0];
    if (!selected) {
      throw new UcpNegotiationError(
        "capabilities_incompatible",
        `No exact shared version for required capability ${name}`,
      );
    }
    capabilities[name] = [{ version: selected.version }];
  }

  return {
    version: business.ucp.version,
    capabilities,
  };
}
