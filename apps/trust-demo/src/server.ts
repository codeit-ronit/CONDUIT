import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createDatabasePool } from "@conduit/infrastructure";
import { MerchantAuthenticationError } from "@conduit/merchant-console";
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
import { journeyScenarioNames, runJourneyScenario } from "./journey-scenarios.js";
import type { JourneyScenarioName } from "./journey-scenarios.js";
import {
  onboardingScenarioNames,
  runOnboardingScenario,
} from "./onboarding-scenarios.js";
import type { OnboardingScenarioName } from "./onboarding-scenarios.js";
import { createMcpDemoSurface } from "./mcp-demo-surface.js";
import {
  createMerchantDemoSurface,
  defaultDemoMerchantPassword,
  demoMerchantEmail,
} from "./merchant-demo-surface.js";
import { protocolScenarioNames, runProtocolScenario } from "./protocol-scenarios.js";
import type { ProtocolScenarioName } from "./protocol-scenarios.js";
import { runScenario, scenarioNames } from "./scenarios.js";
import type { ScenarioName } from "./scenarios.js";
import { createUcpShoppingDemoSurface } from "./ucp-shopping-surface.js";

const pool = createDatabasePool();
const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
const port = Number(process.env.PORT ?? "4310");
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${String(port)}`;
const mcpSurface = await createMcpDemoSurface(pool, publicBaseUrl);
const merchantSurface = await createMerchantDemoSurface(pool);
const ucpShoppingSurface = await createUcpShoppingDemoSurface(pool, publicBaseUrl);
const merchantSessionCookie = "conduit_merchant_session";

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
          protocol: [...protocolScenarioNames, "mcp-roundtrip", "ucp-cart-checkout"],
          journey: journeyScenarioNames,
          merchant: ["catalog-provenance"],
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
            adds: "Buyer journey, merchant sessions, authenticated MCP, UCP cart and checkout handoff",
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
    if (request.method === "POST" && url.pathname === "/api/merchant/login") {
      if (!sameOrigin(request)) {
        json(response, 403, { error: "Cross-origin login is not allowed" });
        return;
      }
      const credentials = await readCredentials(request);
      const session = await merchantSurface.login(
        credentials.email,
        credentials.password,
      );
      setMerchantSessionCookie(response, session.token);
      json(response, 200, {
        authenticated: true,
        principal: publicMerchantPrincipal(session.principal),
        rawSessionTokenReturnedInJson: false,
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/merchant/logout") {
      if (!sameOrigin(request)) {
        json(response, 403, { error: "Cross-origin logout is not allowed" });
        return;
      }
      await merchantSurface.logout(readCookie(request, merchantSessionCookie));
      clearMerchantSessionCookie(response);
      json(response, 200, { authenticated: false });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/merchant/session") {
      const principal = await merchantSurface.session(
        readCookie(request, merchantSessionCookie),
      );
      json(response, 200, publicMerchantPrincipal(principal));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/merchant/catalog") {
      json(
        response,
        200,
        await merchantSurface.catalog(readCookie(request, merchantSessionCookie)),
      );
      return;
    }
    if (url.pathname === "/mcp") {
      await mcpSurface.handleNode(request, response);
      return;
    }
    if (url.pathname.startsWith("/api/ucp/")) {
      const body =
        request.method === "GET" ? undefined : await readJson(request, 64_000);
      const result = await ucpShoppingSurface.execute(
        request.method ?? "GET",
        url.pathname.slice("/api/ucp".length),
        {
          authorization: request.headers.authorization,
          "ucp-agent": headerValue(request.headers["ucp-agent"]),
          "idempotency-key": headerValue(request.headers["idempotency-key"]),
        },
        body,
      );
      json(response, result.status, result.body);
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/protocol/ucp-cart-checkout"
    ) {
      json(response, 200, await ucpShoppingSurface.runRoundTrip());
      return;
    }
    const approvalMatch = /^\/api\/checkout\/([0-9a-f-]+)\/approve$/u.exec(
      url.pathname,
    );
    if (request.method === "POST" && approvalMatch?.[1]) {
      if (!sameOrigin(request)) {
        json(response, 403, { error: "Cross-origin approval is not allowed" });
        return;
      }
      const body = await readJson(request, 4_096);
      const token =
        typeof body === "object" && body !== null && "token" in body
          ? String(body.token)
          : "";
      const result = await ucpShoppingSurface.approve(approvalMatch[1], token);
      json(response, result.status, result.body);
      return;
    }
    const reviewMatch = /^\/checkout\/([0-9a-f-]+)$/u.exec(url.pathname);
    if (request.method === "GET" && reviewMatch?.[1]) {
      const review = await ucpShoppingSurface.review(
        reviewMatch[1],
        url.searchParams.get("token") ?? "",
      );
      checkoutHtml(
        response,
        review.status,
        reviewMatch[1],
        url.searchParams.get("token") ?? "",
        review.body,
      );
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/protocol/mcp-roundtrip") {
      json(response, 200, await mcpSurface.runRoundTrip());
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/journey/")) {
      const name = url.pathname.slice("/api/journey/".length) as JourneyScenarioName;
      if (!journeyScenarioNames.includes(name)) {
        json(response, 404, { error: "Unknown journey scenario" });
        return;
      }
      json(response, 200, await runJourneyScenario(pool, name));
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
    if (error instanceof MerchantAuthenticationError) {
      json(response, 401, {
        error: error.code,
        message: "Sign in with the local merchant demo account.",
        ...(process.env.NODE_ENV !== "production" && !process.env.DEMO_MERCHANT_PASSWORD
          ? {
              demoCredentials: {
                email: demoMerchantEmail,
                password: defaultDemoMerchantPassword,
              },
            }
          : {}),
      });
      return;
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    json(response, 500, { error: message });
  }
}

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`CONDUIT Trust Lab: http://127.0.0.1:${String(port)}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(
      () =>
        void mcpSurface
          .close()
          .then(() => pool.end())
          .finally(() => process.exit(0)),
    );
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

function checkoutHtml(
  response: ServerResponse,
  status: number,
  checkoutId: string,
  token: string,
  payload: unknown,
): void {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const state = JSON.stringify({ checkoutId, token, status, payload }).replaceAll(
    "<",
    "\\u003c",
  );
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  });
  response.end(`<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review checkout · CONDUIT</title>
<style nonce="${nonce}">
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui;background:#07110f;color:#eefcf6}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 80% 10%,#164b3d 0,transparent 35%),#07110f}main{width:min(760px,calc(100% - 32px));margin:48px auto}.brand{color:#75efbd;letter-spacing:.16em;font-weight:800}.card{margin-top:28px;background:rgba(13,31,27,.94);border:1px solid #285448;border-radius:22px;padding:clamp(22px,5vw,42px);box-shadow:0 24px 80px #0008}.eyebrow{color:#75efbd;font-size:.75rem;letter-spacing:.16em;font-weight:800}h1{font-size:clamp(2rem,7vw,3.6rem);line-height:1;margin:.4em 0}p{color:#b8ccc5;line-height:1.6}.line{display:flex;justify-content:space-between;gap:18px;padding:18px 0;border-top:1px solid #23443b}.line strong{font-size:1.05rem}.line span{color:#9bb5ac}.total{display:flex;justify-content:space-between;align-items:end;border-top:1px solid #3e7565;margin-top:8px;padding-top:24px}.total strong{font-size:2rem}.claims{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0}.chip{border:1px solid #3d6d60;border-radius:999px;padding:7px 10px;font-size:.7rem;letter-spacing:.08em}.real{color:#75efbd}.model{color:#f5cc78}button{width:100%;margin-top:28px;border:0;border-radius:14px;padding:17px;background:#75efbd;color:#062019;font-weight:850;font-size:1rem;cursor:pointer}button:disabled{opacity:.55;cursor:wait}.message{margin-top:18px;padding:14px;border-radius:12px;background:#102a24}.error{color:#ff9d9d}a{color:#75efbd}</style></head>
<body><main><div class="brand">CONDUIT · TRUSTED CHECKOUT</div><section class="card"><div id="view"></div></section></main>
<script nonce="${nonce}">const state=${state};const root=document.querySelector('#view');const money=(currency,amount)=>new Intl.NumberFormat('en-IN',{style:'currency',currency}).format(amount/100);const esc=value=>{const node=document.createElement('span');node.textContent=String(value);return node.innerHTML};function render(data){if(!data||data.error){root.innerHTML='<p class="eyebrow error">CHECKOUT UNAVAILABLE</p><h1>We could not open this review.</h1><p>'+esc(data?.error??'Unknown checkout')+'</p><a href="/">Return to the Trust Lab</a>';return}const complete=data.status==='completed';root.innerHTML='<p class="eyebrow">BUYER REVIEW · '+esc(data.status)+'</p><h1>'+(complete?'Order placed safely.':'Review before placing the order.')+'</h1><p>'+(complete?'This checkout is immutable and linked to the order below.':'The agent prepared this basket. You—not the agent—control the final purchase.')+'</p><div class="claims"><span class="chip real">REAL LOCAL TRUST CHECKS</span><span class="chip model">MODELLED PAYMENT · NO REAL MONEY</span></div>'+data.line_items.map(line=>'<div class="line"><div><strong>'+esc(line.item.title)+'</strong><br><span>Quantity '+esc(line.quantity)+' · server-priced</span></div><strong>'+esc(money(data.currency,line.totals.at(-1).amount))+'</strong></div>').join('')+'<div class="total"><span>Final total</span><strong>'+esc(money(data.currency,data.totals.at(-1).amount))+'</strong></div>'+(complete?'<div class="message">Order <strong>'+esc(data.order.id)+'</strong> is complete.</div>':'<button id="approve">Approve and place modelled order</button><div id="message" class="message">This runs live repricing, authorization, stock, ledger, policy, and durable order checks.</div>') ;if(!complete)document.querySelector('#approve').addEventListener('click',approve)}async function approve(){const button=document.querySelector('#approve');const message=document.querySelector('#message');button.disabled=true;message.textContent='Running the trusted commit gates…';try{const response=await fetch('/api/checkout/'+state.checkoutId+'/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:state.token})});const data=await response.json();if(!response.ok)throw new Error(data.error??'Approval failed');render(data)}catch(error){button.disabled=false;message.classList.add('error');message.textContent=error.message}}render(state.payload);</script></body></html>`);
}

function contentType(file: string): string {
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "text/html; charset=utf-8";
}

async function readCredentials(
  request: IncomingMessage,
): Promise<{ readonly email: string; readonly password: string }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const buffer of request as AsyncIterable<Buffer>) {
    size += buffer.length;
    if (size > 4096) throw new MerchantAuthenticationError();
    chunks.push(buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new MerchantAuthenticationError();
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("email" in value) ||
    !("password" in value) ||
    typeof value.email !== "string" ||
    typeof value.password !== "string"
  ) {
    throw new MerchantAuthenticationError();
  }
  return { email: value.email, password: value.password };
}

async function readJson(
  request: IncomingMessage,
  maximumBytes: number,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const buffer of request as AsyncIterable<Buffer>) {
    size += buffer.length;
    if (size > maximumBytes) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function headerValue(
  value: string | readonly string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

function readCookie(request: IncomingMessage, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || undefined;
  }
  return undefined;
}

function setMerchantSessionCookie(response: ServerResponse, token: string): void {
  const secure = new URL(publicBaseUrl).protocol === "https:" ? "; Secure" : "";
  response.setHeader(
    "set-cookie",
    `${merchantSessionCookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`,
  );
}

function clearMerchantSessionCookie(response: ServerResponse): void {
  response.setHeader(
    "set-cookie",
    `${merchantSessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
  );
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  return !origin || origin === new URL(publicBaseUrl).origin;
}

function publicMerchantPrincipal(principal: {
  readonly displayName: string;
  readonly email: string;
  readonly merchantName: string;
  readonly role: string;
  readonly expiresAt: string;
}) {
  return {
    displayName: principal.displayName,
    email: principal.email,
    merchantName: principal.merchantName,
    role: principal.role,
    expiresAt: principal.expiresAt,
  };
}
