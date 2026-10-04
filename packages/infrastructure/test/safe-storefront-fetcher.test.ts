import { describe, expect, it } from "vitest";

import { SafeStorefrontFetcher, isPublicIp } from "../src/safe-storefront-fetcher.js";
import type { StorefrontTransport } from "../src/safe-storefront-fetcher.js";

describe("SSRF-safe storefront fetching", () => {
  it("rejects private and reserved IPv4/IPv6 ranges", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "::1",
      "fc00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPublicIp(address), address).toBe(false);
    }
    expect(isPublicIp("93.184.216.34")).toBe(true);
    expect(isPublicIp("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
  });

  it("revalidates DNS after every redirect and blocks a private second hop", async () => {
    const transport: StorefrontTransport = {
      get: (url) =>
        Promise.resolve(
          url.hostname === "public.example"
            ? {
                status: 302,
                location: "http://internal.example/product",
                contentType: "text/html",
                body: "",
              }
            : { status: 200, location: null, contentType: "text/html", body: "bad" },
        ),
    };
    const fetcher = new SafeStorefrontFetcher({
      resolve: (hostname) =>
        Promise.resolve([
          {
            address: hostname === "public.example" ? "93.184.216.34" : "127.0.0.1",
            family: 4,
          },
        ]),
      transport,
    });
    await expect(fetcher.fetch("https://public.example/product")).rejects.toThrow(
      "private or reserved",
    );
  });

  it("pins the validated public address and enforces HTML", async () => {
    let connectedAddress = "";
    const transport: StorefrontTransport = {
      get: (_url, address) => {
        connectedAddress = address.address;
        return Promise.resolve({
          status: 200,
          location: null,
          contentType: "text/html; charset=utf-8",
          body: "<html>safe</html>",
        });
      },
    };
    const fetcher = new SafeStorefrontFetcher({
      resolve: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]),
      transport,
    });
    const document = await fetcher.fetch("https://example.com/product");
    expect(connectedAddress).toBe("93.184.216.34");
    expect(document.html).toContain("safe");
  });
});
