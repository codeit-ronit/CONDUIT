import {
  CommerceService,
  DeterministicModelledOrderProvider,
} from "@conduit/application";
import { ToolBoundary } from "@conduit/enforcement";
import type { BoundaryInvocationResult } from "@conduit/enforcement";
import {
  PostgresBoundaryRepository,
  PostgresCommerceRepository,
} from "@conduit/infrastructure";
import type { Pool } from "@conduit/infrastructure";

import { ModelledToolRuntime } from "./modelled-tool-runtime.js";

export const boundaryScenarioNames = [
  "trusted-read",
  "permission-narrowing",
  "human-approval",
  "unknown-tool",
  "schema-drift",
  "pii-redaction",
  "concurrent-audit",
] as const;

export type BoundaryScenarioName = (typeof boundaryScenarioNames)[number];

export async function runBoundaryScenario(pool: Pool, name: BoundaryScenarioName) {
  const runtime = new ModelledToolRuntime();
  const repository = new PostgresBoundaryRepository(pool);
  const boundary = new ToolBoundary(repository, runtime);
  const commerce = new CommerceService(
    new PostgresCommerceRepository(pool),
    new DeterministicModelledOrderProvider(),
  );
  const suffix = crypto.randomUUID().slice(0, 8);
  const tenant = await commerce.createTenant({
    slug: `boundary-${suffix}`,
    displayName: "CONDUIT Boundary Lab",
  });
  const started = await boundary.startRun(
    tenant.id,
    "Find dinner without beef for Ronit at ronit@example.com",
    ["Ronit"],
  );
  const calls: BoundaryInvocationResult[] = [];

  if (
    name === "trusted-read" ||
    name === "permission-narrowing" ||
    name === "human-approval" ||
    name === "concurrent-audit"
  ) {
    await boundary.approveDiscoveredTool(tenant.id, "catalog.search", "READ_ONLY");
  }
  if (name === "permission-narrowing" || name === "human-approval") {
    await boundary.approveDiscoveredTool(tenant.id, "purchase.commit", "BINDING_WRITE");
  }
  if (name === "schema-drift") {
    await boundary.approveDiscoveredTool(
      tenant.id,
      "cart.set_line",
      "REVERSIBLE_WRITE",
    );
    runtime.setMode("SCHEMA_DRIFT");
  }
  if (name === "pii-redaction") {
    await boundary.approveDiscoveredTool(
      tenant.id,
      "customer.notify",
      "EXTERNAL_EFFECT",
    );
  }
  if (name === "unknown-tool") runtime.setMode("UNKNOWN_TOOL");

  if (name === "concurrent-audit") {
    calls.push(
      ...(await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          boundary.invoke({
            tenantId: tenant.id,
            runId: started.run.id,
            toolName: "catalog.search",
            input: { category: "dinner" },
            correlationId: `concurrent-${String(index + 1)}`,
          }),
        ),
      )),
    );
  } else if (name === "unknown-tool") {
    calls.push(
      await boundary.invoke({
        tenantId: tenant.id,
        runId: started.run.id,
        toolName: "merchant.export_customers",
        input: {},
        correlationId: "unknown-tool",
      }),
    );
  } else if (name === "schema-drift") {
    calls.push(
      await boundary.invoke({
        tenantId: tenant.id,
        runId: started.run.id,
        toolName: "cart.set_line",
        input: { productId: "product-paneer-01", quantity: 2, clientPrice: "1" },
        correlationId: "schema-drift",
      }),
    );
  } else if (name === "pii-redaction") {
    calls.push(
      await boundary.invoke({
        tenantId: tenant.id,
        runId: started.run.id,
        toolName: "customer.notify",
        input: { email: "ronit@example.com", phone: "+91 98765 43210" },
        correlationId: "pii-redaction",
      }),
    );
  } else {
    calls.push(
      await boundary.invoke({
        tenantId: tenant.id,
        runId: started.run.id,
        toolName: "catalog.search",
        input: { category: "dinner" },
        correlationId: "catalog-read",
      }),
    );
    if (name === "permission-narrowing" || name === "human-approval") {
      calls.push(
        await boundary.invoke({
          tenantId: tenant.id,
          runId: started.run.id,
          toolName: "purchase.commit",
          input: { cartId: "demo-cart", operationKey: `demo:${suffix}` },
          correlationId: "commit-after-untrusted",
        }),
      );
    }
    if (name === "human-approval") {
      calls.push(
        await boundary.invoke({
          tenantId: tenant.id,
          runId: started.run.id,
          toolName: "purchase.commit",
          input: { cartId: "demo-cart", operationKey: `approved:${suffix}` },
          correlationId: "approved-commit",
          humanApprovalId: `human:${suffix}`,
        }),
      );
    }
  }

  const auditEntries = await repository.listAudit(tenant.id);
  const parsedEntries = auditEntries.map((entry) => ({
    sequence: entry.sequence,
    previousHash: entry.previousHash,
    entryHash: entry.entryHash,
    ...parsePayload(entry.canonicalPayload),
  }));
  const serializedSurface = JSON.stringify({
    operatorContext: started.operatorContext,
    calls,
    parsedEntries,
  });

  return {
    phase: 3,
    scenario: name,
    title: scenarioTitle(name),
    lesson: scenarioLesson(name),
    claimLevel: "MODELLED",
    run: started.run,
    operatorContext: started.operatorContext,
    discovery: await boundary.reconcileTools(tenant.id),
    calls,
    audit: {
      verification: await boundary.verifyAudit(tenant.id),
      entries: parsedEntries,
      rawPiiPresent:
        serializedSurface.includes("ronit@example.com") ||
        serializedSurface.includes("98765 43210"),
    },
  };
}

function parsePayload(payload: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(payload);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : { payload: parsed };
}

function scenarioTitle(name: BoundaryScenarioName): string {
  return {
    "trusted-read": "Trusted data, quarantined prose",
    "permission-narrowing": "Permissions narrow after untrusted text",
    "human-approval": "Human approval unlocks one binding call",
    "unknown-tool": "Unknown tool denied",
    "schema-drift": "Changed schema denied",
    "pii-redaction": "PII tokenized everywhere",
    "concurrent-audit": "Concurrent calls, gapless chain",
  }[name];
}

function scenarioLesson(name: BoundaryScenarioName): string {
  return {
    "trusted-read":
      "Structured price and stock stay trusted as data; merchant prose is wrapped with a fresh per-run marker.",
    "permission-narrowing":
      "After untrusted prose enters context, a binding call stops for explicit human approval.",
    "human-approval":
      "Approval applies to one typed call; it does not make merchant prose trusted or widen the whole run.",
    "unknown-tool":
      "Runtime discovery found a capability with no approved snapshot, so the boundary failed closed.",
    "schema-drift":
      "A previously approved tool changed its input contract; execution stopped before forwarding.",
    "pii-redaction":
      "The runtime may need contact data, but responses and audit surfaces receive only session tokens.",
    "concurrent-audit":
      "PostgreSQL serializes tenant audit appends, producing complete sequence and hash links under concurrency.",
  }[name];
}
