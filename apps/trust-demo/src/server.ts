import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createDatabasePool } from "@conduit/infrastructure";
import { createUcpBusinessProfile } from "@conduit/protocol-adapters";

import { agentScenarioNames, runAgentScenario } from "./agent-scenarios.js";
import type { AgentScenarioName } from "./agent-scenarios.js";
import { boundaryScenarioNames, runBoundaryScenario } from "./boundary-scenarios.js";
import type { BoundaryScenarioName } from "./boundary-scenarios.js";
import {
  evaluationScenarioNames,
  runEvaluationScenario,
} from "./evaluation-scenarios.js";
import type { EvaluationScenarioName } from "./evaluation-scenarios.js";
import {
  onboardingScenarioNames,
  runOnboardingScenario,
} from "./onboarding-scenarios.js";
import type { OnboardingScenarioName } from "./onboarding-scenarios.js";
import { protocolScenarioNames, runProtocolScenario } from "./protocol-scenarios.js";
import type { ProtocolScenarioName } from "./protocol-scenarios.js";
import { runScenario, scenarioNames } from "./scenarios.js";
import type { ScenarioName } from "./scenarios.js";

const pool = createDatabasePool();
const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
const port = Number(process.env.PORT ?? "4310");
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${String(port)}`;

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );
    if (request.method === "GET" && url.pathname === "/api/overview") {
      json(response, 200, {
        claimLevel: "MODELLED",
        phase: 7,
        scenarios: {
          commerce: scenarioNames,
          boundary: boundaryScenarioNames,
          agent: agentScenarioNames,
          onboarding: onboardingScenarioNames,
          evaluation: evaluationScenarioNames,
          protocol: protocolScenarioNames,
        },
        phases: [
          {
            phase: 1,
            title: "Commerce skeleton",
            adds: "Server prices, cart, stock, immutable receipt",
          },
          {
            phase: 2,
            title: "Trust kernel",
            adds: "Authorization, policy, ledger, outbox, reconciliation",
          },
          {
            phase: 3,
            title: "Enforcement boundary",
            adds: "Tool governance, quarantine, redaction, audit chain",
          },
          {
            phase: 4,
            title: "Bounded AI buyer",
            adds: "Typed intent, state machine, budgets, model adapters",
          },
          {
            phase: 5,
            title: "Merchant onboarding",
            adds: "Reviewed imports, provenance, merge-only catalog writes",
          },
          {
            phase: 6,
            title: "Evidence and red team",
            adds: "Versioned expectations, hard-zero gates, A/B control ablations",
          },
          {
            phase: 7,
            title: "Product and protocol surface",
            adds: "UCP discovery, authenticated identity binding, scoped catalog",
          },
        ],
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/.well-known/ucp") {
      response.setHeader("cache-control", "public, max-age=60");
      json(response, 200, createUcpBusinessProfile(publicBaseUrl));
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/protocol/")) {
      const name = url.pathname.slice("/api/protocol/".length) as ProtocolScenarioName;
      if (!protocolScenarioNames.includes(name)) {
        json(response, 404, { error: "Unknown protocol scenario" });
        return;
      }
      json(response, 200, await runProtocolScenario(pool, name));
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/evaluations/")) {
      const name = url.pathname.slice(
        "/api/evaluations/".length,
      ) as EvaluationScenarioName;
      if (!evaluationScenarioNames.includes(name)) {
        json(response, 404, { error: "Unknown evaluation scenario" });
        return;
      }
      json(response, 200, await runEvaluationScenario(pool, name));
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/agent/")) {
      const name = url.pathname.slice("/api/agent/".length) as AgentScenarioName;
      if (!agentScenarioNames.includes(name)) {
        json(response, 404, { error: "Unknown agent scenario" });
        return;
      }
      json(response, 200, await runAgentScenario(pool, name));
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/onboarding/")) {
      const name = url.pathname.slice(
        "/api/onboarding/".length,
      ) as OnboardingScenarioName;
      if (!onboardingScenarioNames.includes(name)) {
        json(response, 404, { error: "Unknown onboarding scenario" });
        return;
      }
      json(response, 200, await runOnboardingScenario(pool, name));
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/boundary/")) {
      const name = url.pathname.slice("/api/boundary/".length) as BoundaryScenarioName;
      if (!boundaryScenarioNames.includes(name)) {
        json(response, 404, { error: "Unknown boundary scenario" });
        return;
      }
      json(response, 200, await runBoundaryScenario(pool, name));
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/scenarios/")) {
      const name = url.pathname.slice("/api/scenarios/".length) as ScenarioName;
      if (!scenarioNames.includes(name)) {
        json(response, 404, { error: "Unknown scenario" });
        return;
      }
      json(response, 200, await runScenario(pool, name));
      return;
    }
    if (request.method === "GET") {
      const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (!new Set(["index.html", "app.js", "styles.css"]).has(file)) {
        json(response, 404, { error: "Not found" });
        return;
      }
      const body = await readFile(`${publicDirectory}/${file}`);
      response.writeHead(200, { "content-type": contentType(file) });
      response.end(body);
      return;
    }
    json(response, 405, { error: "Method not allowed" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    json(response, 500, { error: message });
  }
}

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`CONDUIT Trust Lab: http://127.0.0.1:${String(port)}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => void pool.end().finally(() => process.exit(0)));
  });
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  );
}

function contentType(file: string): string {
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "text/html; charset=utf-8";
}
