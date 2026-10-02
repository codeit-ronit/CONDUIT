# ADR-0007: Database-serialized audit chain and pre-persistence tokenization

**Status:** accepted  
**Date:** 2026-10-02

## Context

An audit history must prove which tool was proposed, how policy decided, and what
happened. A database identity sequence may contain rollback gaps, and concurrent
application processes make in-memory sequence locks incorrect. Audit logs also become a
long-lived liability if they contain customer data.

## Decision

- Append exactly one `DECISION` and one `OUTCOME` entry for every intercepted call.
- Keep one audit head per tenant and lock that row inside a PostgreSQL transaction.
- Allocate the next sequence only while holding that lock, then insert the entry and
  update the head in the same transaction. Rollback therefore cannot leave a gap.
- Hash tenant, sequence, previous hash, and canonical payload using PostgreSQL
  `pgcrypto`.
- Verify the chain independently in Node rather than trusting the stored head.
- Reject normal `UPDATE` and `DELETE` operations with a database trigger.
- Tokenize registered sensitive values, sensitive JSON fields, emails, phone numbers,
  and payment-number patterns before output or audit persistence.
- Keep the reversible raw-to-token map only in the process-scoped redaction session.

## Consequences and limits

- Concurrent processes can append a gapless tenant chain safely, though the tenant head
  is intentionally a serialization point.
- The chain is **tamper-evident, not tamper-proof**. A database owner could disable the
  trigger and recompute all later hashes.
- Real tamper resistance requires an external append-only anchor or write-once storage;
  that is not implemented and must never be implied by the UI.
- Pattern and field-name detection cannot discover every form of PII. Identity systems
  must register known sensitive values such as a person's name when starting a run.
- The in-memory token map is not durable or encrypted. That is acceptable only for this
  local synthetic demo; production needs a scoped encrypted token vault.

## Rejected alternatives

- **Database identity as audit sequence:** rolled-back allocations create gaps that look
  like deletion.
- **Application mutex:** does not coordinate multiple processes.
- **Redact only when rendering:** raw PII would already exist in durable logs.
- **Call the chain immutable:** that would overclaim what hash linking actually proves.
