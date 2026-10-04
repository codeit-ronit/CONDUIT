import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";

import type { StorefrontDocument, StorefrontFetcher } from "@conduit/onboarding";

interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

interface TransportResponse {
  readonly status: number;
  readonly location: string | null;
  readonly contentType: string;
  readonly body: string;
}

export interface StorefrontTransport {
  get(
    url: URL,
    address: ResolvedAddress,
    maximumBytes: number,
    timeoutMs: number,
  ): Promise<TransportResponse>;
}

export interface SafeStorefrontFetcherOptions {
  readonly maximumBytes?: number;
  readonly maximumRedirects?: number;
  readonly timeoutMs?: number;
  readonly resolve?: (hostname: string) => Promise<readonly ResolvedAddress[]>;
  readonly transport?: StorefrontTransport;
}

export class SafeStorefrontFetcher implements StorefrontFetcher {
  readonly #maximumBytes: number;
  readonly #maximumRedirects: number;
  readonly #timeoutMs: number;
  readonly #resolve: (hostname: string) => Promise<readonly ResolvedAddress[]>;
  readonly #transport: StorefrontTransport;

  public constructor(options: SafeStorefrontFetcherOptions = {}) {
    this.#maximumBytes = options.maximumBytes ?? 2_000_000;
    this.#maximumRedirects = options.maximumRedirects ?? 5;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#resolve = options.resolve ?? resolveAll;
    this.#transport = options.transport ?? new PinnedAddressTransport();
  }

  public async fetch(rawUrl: string): Promise<StorefrontDocument> {
    let current = parseAllowedUrl(rawUrl);
    const redirects: string[] = [];
    for (let hop = 0; hop <= this.#maximumRedirects; hop += 1) {
      const addresses = await this.#resolve(current.hostname);
      if (addresses.length === 0)
        throw new Error("Storefront hostname resolved to no addresses");
      if (addresses.some((entry) => !isPublicIp(entry.address)))
        throw new Error("Storefront URL resolves to a private or reserved address");
      const selected = addresses[0];
      if (!selected) throw new Error("Storefront address selection failed");
      const response = await this.#transport.get(
        current,
        selected,
        this.#maximumBytes,
        this.#timeoutMs,
      );
      if (isRedirect(response.status)) {
        if (!response.location) throw new Error("Redirect response has no Location");
        if (hop === this.#maximumRedirects)
          throw new Error("Storefront exceeded the redirect limit");
        current = parseAllowedUrl(new URL(response.location, current).toString());
        redirects.push(current.toString());
        continue;
      }
      if (response.status < 200 || response.status >= 300)
        throw new Error(`Storefront returned HTTP ${String(response.status)}`);
      if (!response.contentType.toLowerCase().includes("text/html"))
        throw new Error("Storefront response is not HTML");
      return {
        finalUrl: current.toString(),
        redirects,
        contentType: response.contentType,
        html: response.body,
      };
    }
    throw new Error("Storefront redirect loop did not terminate");
  }
}

export function isPublicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return publicIpv4(address);
  if (family === 6) return publicIpv6(address);
  return false;
}

class PinnedAddressTransport implements StorefrontTransport {
  public get(
    url: URL,
    address: ResolvedAddress,
    maximumBytes: number,
    timeoutMs: number,
  ): Promise<TransportResponse> {
    return new Promise((resolve, reject) => {
      const lookup: LookupFunction = (_hostname, options, callback) => {
        if (typeof options === "object" && options.all) {
          callback(null, [address]);
          return;
        }
        callback(null, address.address, address.family);
      };
      const requester = url.protocol === "https:" ? httpsRequest : httpRequest;
      const request = requester(
        url,
        {
          method: "GET",
          headers: {
            accept: "text/html,application/xhtml+xml",
            "user-agent": "CONDUIT-Catalog-Onboarding/1.0",
          },
          lookup,
          signal: AbortSignal.timeout(timeoutMs),
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maximumBytes) {
              request.destroy(new Error("Storefront response exceeded the size limit"));
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            resolve({
              status: response.statusCode ?? 0,
              location:
                typeof response.headers.location === "string"
                  ? response.headers.location
                  : null,
              contentType:
                typeof response.headers["content-type"] === "string"
                  ? response.headers["content-type"]
                  : "",
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );
      request.on("error", reject);
      request.end();
    });
  }
}

async function resolveAll(hostname: string): Promise<readonly ResolvedAddress[]> {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.flatMap((entry) =>
    entry.family === 4 || entry.family === 6
      ? [{ address: entry.address, family: entry.family }]
      : [],
  );
}

function parseAllowedUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Storefront URL must use HTTP or HTTPS");
  if (url.username || url.password)
    throw new Error("Storefront URL must not contain credentials");
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  )
    throw new Error("Local storefront hostnames are not allowed");
  if (url.port && !new Set(["80", "443"]).has(url.port))
    throw new Error("Storefront URL uses a non-web port");
  return url;
}

function publicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  if (first === 0 || first === 10 || first === 127 || first >= 224) return false;
  if (first === 100 && second >= 64 && second <= 127) return false;
  if (first === 169 && second === 254) return false;
  if (first === 172 && second >= 16 && second <= 31) return false;
  if (first === 192 && new Set([0, 2, 168]).has(second)) return false;
  if (first === 198 && new Set([18, 19, 51]).has(second)) return false;
  if (first === 203 && second === 0) return false;
  return true;
}

function publicIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  if (normalized === "::" || normalized === "::1") return false;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return false;
  if (/^fe[89ab]/u.test(normalized)) return false;
  if (normalized.startsWith("ff") || normalized.startsWith("2001:db8")) return false;
  if (normalized.startsWith("::ffff:"))
    return publicIpv4(normalized.slice("::ffff:".length));
  return true;
}

function isRedirect(status: number): boolean {
  return new Set([301, 302, 303, 307, 308]).has(status);
}
