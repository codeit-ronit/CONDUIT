import {
  AUDIT_GENESIS_HASH,
  RedactionSession,
  auditPayload,
  calculateAuditHash,
  canonicalJson,
  verifyAuditChain,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

describe("central observability controls", () => {
  it("canonicalizes object keys recursively", () => {
    expect(canonicalJson({ z: 1, a: { y: true, b: false } })).toBe(
      '{"a":{"b":false,"y":true},"z":1}',
    );
  });

  it("tokenizes seeded and detected PII consistently", () => {
    const redactor = new RedactionSession();
    redactor.register("Ronit Kumar", "SECRET");
    const value = redactor.redactJson({
      buyer: "Ronit Kumar",
      customerName: "A Different Person",
      contact: "ronit@example.com or +91 98765 43210",
      repeated: "ronit@example.com",
    });
    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain("Ronit Kumar");
    expect(serialized).not.toContain("A Different Person");
    expect(serialized).not.toContain("ronit@example.com");
    expect(serialized).not.toContain("98765 43210");
    expect(serialized).toContain("<EMAIL_1>");
    expect(serialized.match(/<EMAIL_1>/gu)).toHaveLength(2);
  });

  it("detects a modified audit payload independently", () => {
    const tenantId = "tenant-1";
    const firstPayload = auditPayload({ phase: "DECISION", outcome: "ALLOW" });
    const firstHash = calculateAuditHash(tenantId, 1, AUDIT_GENESIS_HASH, firstPayload);
    const secondPayload = auditPayload({ phase: "OUTCOME", outcome: "SUCCEEDED" });
    const secondHash = calculateAuditHash(tenantId, 2, firstHash, secondPayload);
    const entries = [
      {
        tenantId,
        sequence: 1,
        previousHash: AUDIT_GENESIS_HASH,
        entryHash: firstHash,
        canonicalPayload: firstPayload,
      },
      {
        tenantId,
        sequence: 2,
        previousHash: firstHash,
        entryHash: secondHash,
        canonicalPayload: secondPayload,
      },
    ];
    expect(verifyAuditChain(entries).valid).toBe(true);
    const first = entries[0];
    const second = entries[1];
    if (!first || !second) throw new Error("Expected two audit entries");
    expect(verifyAuditChain([{ ...first, canonicalPayload: "{}" }, second]).valid).toBe(
      false,
    );
  });
});
