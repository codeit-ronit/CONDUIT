import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createDatabasePool } from "@conduit/infrastructure";

import { boundaryScenarioNames, runBoundaryScenario } from "./boundary-scenarios.js";
import type { BoundaryScenarioName } from "./boundary-scenarios.js";
import { runScenario, scenarioNames } from "./scenarios.js";
import type { ScenarioName } from "./scenarios.js";

const pool = createDatabasePool();
const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
const port = Number(process.env.PORT ?? "4310");

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
        phase: 3,
        scenarios: { commerce: scenarioNames, boundary: boundaryScenarioNames },
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
        ],
      });
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
