import { createHash } from "node:crypto";

import { canonicalJson } from "./json.js";
import type { JsonValue } from "./json.js";

export const AUDIT_GENESIS_HASH = "0".repeat(64);

export interface AuditEntry {
  readonly tenantId: string;
  readonly sequence: number;
  readonly previousHash: string;
  readonly entryHash: string;
  readonly canonicalPayload: string;
}

export interface AuditVerification {
  readonly valid: boolean;
  readonly entryCount: number;
  readonly headHash: string;
  readonly failureSequence: number | null;
  readonly explanation: string;
}

export function auditPayload(value: JsonValue): string {
  return canonicalJson(value);
}

export function calculateAuditHash(
  tenantId: string,
  sequence: number,
  previousHash: string,
  canonicalPayload: string,
): string {
  return createHash("sha256")
    .update(
      `${tenantId}\n${String(sequence)}\n${previousHash}\n${canonicalPayload}`,
      "utf8",
    )
    .digest("hex");
}

/** Independent verifier: it does not trust the database's stored head hash. */
export function verifyAuditChain(entries: readonly AuditEntry[]): AuditVerification {
  let previousHash = AUDIT_GENESIS_HASH;
  let expectedSequence = 1;
  for (const entry of entries) {
    const expectedHash = calculateAuditHash(
      entry.tenantId,
      expectedSequence,
      previousHash,
      entry.canonicalPayload,
    );
    if (
      entry.sequence !== expectedSequence ||
      entry.previousHash !== previousHash ||
      entry.entryHash !== expectedHash
    ) {
      return {
        valid: false,
        entryCount: entries.length,
        headHash: previousHash,
        failureSequence: expectedSequence,
        explanation: `Audit chain failed at expected sequence ${String(expectedSequence)}.`,
      };
    }
    previousHash = entry.entryHash;
    expectedSequence += 1;
  }
  return {
    valid: true,
    entryCount: entries.length,
    headHash: previousHash,
    failureSequence: null,
    explanation: "Every sequence and hash link is complete.",
  };
}
