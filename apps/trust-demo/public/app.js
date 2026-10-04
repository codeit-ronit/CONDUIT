const buttons = [...document.querySelectorAll(".scenario")];
const tabs = [...document.querySelectorAll(".lab-tab")];
const lists = [...document.querySelectorAll("[data-list]")];
const runButton = document.querySelector("#run-button");
const empty = document.querySelector("#empty-state");
const loading = document.querySelector("#loading-state");
const result = document.querySelector("#result");
let activeLab = "journey";
const selectedByLab = {
  journey: "buyer-purchase",
  commerce: "authorized",
  boundary: "trusted-read",
  agent: "scripted",
  onboarding: "spreadsheet-preview",
  evaluation: "safety-regression",
  protocol: "profile-discovery",
};

for (const button of buttons) {
  button.addEventListener("click", () => {
    selectedByLab[activeLab] = button.dataset.scenario;
    for (const candidate of buttons) {
      if (candidate.closest("[data-list]")?.dataset.list === activeLab) {
        candidate.classList.toggle("active", candidate === button);
      }
    }
    runButton.firstChild.textContent = `Run ${button.querySelector("strong").textContent.toLowerCase()} `;
  });
}

for (const tab of tabs) {
  tab.addEventListener("click", () => {
    activeLab = tab.dataset.lab;
    for (const candidate of tabs) {
      candidate.classList.toggle("active", candidate === tab);
      candidate.setAttribute("aria-selected", String(candidate === tab));
    }
    for (const list of lists)
      list.classList.toggle("hidden", list.dataset.list !== activeLab);
    const activeButton = document.querySelector(
      `[data-list="${activeLab}"] [data-scenario="${selectedByLab[activeLab]}"]`,
    );
    runButton.firstChild.textContent = `Run ${activeButton.querySelector("strong").textContent.toLowerCase()} `;
    empty.classList.remove("hidden");
    result.classList.add("hidden");
  });
}

runButton.addEventListener("click", async () => {
  runButton.disabled = true;
  empty.classList.add("hidden");
  result.classList.add("hidden");
  loading.classList.remove("hidden");
  try {
    const selected = selectedByLab[activeLab];
    const endpoint =
      activeLab === "boundary"
        ? `/api/boundary/${selected}`
        : activeLab === "agent"
          ? `/api/agent/${selected}`
          : activeLab === "onboarding"
            ? `/api/onboarding/${selected}`
            : activeLab === "evaluation"
              ? `/api/evaluations/${selected}`
              : activeLab === "protocol"
                ? `/api/protocol/${selected}`
                : activeLab === "journey"
                  ? `/api/journey/${selected}`
                  : `/api/scenarios/${selected}`;
    const response = await fetch(endpoint, { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Scenario failed");
    if (data.surface === "BUYER_JOURNEY") renderJourney(data);
    else if (data.surface === "MCP_CATALOG") renderMcp(data);
    else if (data.phase === 7) renderProtocol(data);
    else if (data.phase === 6) renderEvaluation(data);
    else if (data.phase === 5) renderOnboarding(data);
    else if (data.phase === 4) renderAgent(data);
    else if (data.phase === 3) renderBoundary(data);
    else renderCommerce(data);
  } catch (error) {
    result.innerHTML = `<div class="error"><h3>Scenario failed</h3><p>${escapeHtml(error.message)}</p></div>`;
  } finally {
    loading.classList.add("hidden");
    result.classList.remove("hidden");
    runButton.disabled = false;
  }
});

function renderJourney(data) {
  result.innerHTML = `
    <div class="result-head">
      <div><p class="eyebrow">BUYER CONSOLE · COMPLETE TRACE</p><h2>${escapeHtml(data.title)}</h2><p>${escapeHtml(data.lesson)}</p></div>
      <span class="outcome allow">PURCHASE COMPLETE</span>
    </div>
    <div class="journey-timeline">
      ${data.stages
        .map(
          (stage, index) => `<article class="journey-stage">
            <div class="journey-rail"><span>${index + 1}</span>${index < data.stages.length - 1 ? "<i></i>" : ""}</div>
            <div class="journey-body">
              <div class="journey-title"><div><span class="provenance-label">${escapeHtml(stage.key)}</span><h3>${escapeHtml(stage.title)}</h3></div><span class="claim-token ${claimClass(stage.claim)}">${escapeHtml(stage.claim)}</span></div>
              <p>${escapeHtml(stage.explanation)}</p>
              <div class="journey-evidence">${Object.entries(stage.evidence)
                .map(
                  ([key, value]) =>
                    `<div><span>${escapeHtml(humanize(key))}</span><strong>${escapeHtml(displayValue(value))}</strong></div>`,
                )
                .join("")}</div>
            </div>
          </article>`,
        )
        .join("")}
    </div>
    <div class="receipt-card">
      <div><span class="provenance-label">FINAL TOTAL</span><strong>${money({ currency: data.totals.currency, minorUnits: data.totals.chargedMinorUnits })}</strong></div>
      <div><span class="provenance-label">REAL MONEY MOVED</span><strong>${data.totals.realExternalCharge ? "YES" : "NO — MODELLED PROVIDER"}</strong></div>
      <span class="receipt-check">✓</span>
    </div>
    <button class="raw-toggle">Show exact response JSON</button>
    <pre class="raw hidden">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  wireRawToggle();
}

function renderMcp(data) {
  const products = data.response?.products ?? [];
  result.innerHTML = `
    <div class="result-head">
      <div><p class="eyebrow">MCP 2026-07-28 · UCP 2026-08-25</p><h2>${escapeHtml(data.title)}</h2><p>${escapeHtml(data.lesson)}</p></div>
      <span class="outcome allow">ROUND TRIP PASSED</span>
    </div>
    <div class="claim-strip">
      <span class="claim-token real">REAL LOCAL</span><span>Official MCP client/server execution + PostgreSQL</span>
      <span class="claim-token modelled">MODELLED</span><span>Local platform API key</span>
      <span class="claim-token referenced">REFERENCED</span><span>UCP MCP tool shape</span>
    </div>
    <div class="result-grid">
      <article class="data-card">
        <h3>1 · TRANSPORT NEGOTIATION</h3>
        <div class="metric"><span>Protocol</span><strong>${escapeHtml(data.transport.protocol)}</strong></div>
        <div class="metric"><span>Negotiated era</span><strong>${escapeHtml(data.transport.negotiatedEra)}</strong></div>
        <div class="metric"><span>SDK</span><strong>${escapeHtml(data.transport.sdk)}</strong></div>
        <div class="metric"><span>Discovered tools</span><strong>${escapeHtml(data.transport.toolNames.join(", "))}</strong></div>
      </article>
      <article class="data-card">
        <h3>2 · AUTHENTICATED TOOL REQUEST</h3>
        <div class="metric"><span>Tool</span><strong>${escapeHtml(data.request.tool)}</strong></div>
        <div class="metric"><span>UCP-Agent</span><strong>${escapeHtml(data.request.meta["ucp-agent"].profile)}</strong></div>
        <div class="metric"><span>Bearer returned to browser</span><strong>${data.request.bearerSecretReturnedToBrowser ? "YES" : "NO"}</strong></div>
      </article>
      <article class="data-card gates">
        <h3>3 · SCOPED RESULT</h3>
        <div class="metric"><span>PostgreSQL reads</span><strong>${data.catalogReads}</strong></div>
        ${products
          .map(
            (product) =>
              `<div class="protocol-product"><div><span class="provenance-label">MCP STRUCTURED CONTENT</span><h4>${escapeHtml(product.title)}</h4><p>${escapeHtml(product.variants[0]?.sku)}</p></div><strong>${money({ currency: product.price_range.min.currency, minorUnits: String(product.price_range.min.amount) })}</strong></div>`,
          )
          .join("")}
      </article>
      <article class="data-card gates"><h3>CLAIM BOUNDARY</h3><div class="metric"><span>Current state</span><strong>${escapeHtml(data.conformance)}</strong></div><p class="gate-detail">The transport round trip is real and tested. Public HTTPS, OAuth resource metadata, remote profile fetching, and official UCP conformance are still separate gates.</p></article>
    </div>
    <button class="raw-toggle">Show exact response JSON</button>
    <pre class="raw hidden">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  wireRawToggle();
}

function claimClass(claim) {
  if (claim === "REAL_LOCAL_DATABASE") return "real";
  if (claim === "MODELLED") return "modelled";
  return "referenced";
}

function displayValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "YES" : "NO";
  return value ?? "—";
}

function renderProtocol(data) {
  const blocked = data.blocked === true;
  const outcome = blocked
    ? { label: "BLOCKED SAFELY", className: "deny" }
    : data.catalog
      ? { label: "AUTHENTICATED", className: "allow" }
      : { label: "DISCOVERABLE", className: "warn" };
  const capability = "dev.ucp.shopping.catalog.search";
  result.innerHTML = `
    <div class="result-head">
      <div><p class="eyebrow">UCP 2026-08-25 · VERTICAL SLICE</p><h2>${escapeHtml(data.title)}</h2><p>${escapeHtml(data.lesson)}</p></div>
      <span class="outcome ${outcome.className}">${outcome.label}</span>
    </div>
    <div class="claim-strip">
      <span class="claim-token real">REAL LOCAL</span><span>PostgreSQL catalog and tenant scope</span>
      <span class="claim-token modelled">MODELLED</span><span>Local buyer-agent credentials</span>
      <span class="claim-token referenced">REFERENCED</span><span>UCP contract version</span>
    </div>
    <div class="result-grid">
      <article class="data-card">
        <h3>1 · DISCOVERY PROFILE</h3>
        <div class="metric"><span>Protocol release</span><strong>${escapeHtml(data.implementation?.pinnedRelease)}</strong></div>
        <div class="metric"><span>Advertised capability</span><strong>${escapeHtml(capability)}</strong></div>
        <div class="metric"><span>Conformance</span><strong>${escapeHtml(data.implementation?.conformance)}</strong></div>
        <p class="gate-detail">Checkout and payments are deliberately absent because this protocol slice does not implement them yet.</p>
      </article>
      <article class="data-card">
        <h3>2 · IDENTITY + NEGOTIATION</h3>
        ${
          blocked
            ? `<div class="metric"><span>Stopped at</span><strong>${escapeHtml(data.failure.stage)}</strong></div><div class="metric"><span>Reason</span><strong>${escapeHtml(data.failure.code)}</strong></div><p class="unknown-note">${escapeHtml(data.failure.message)}</p>`
            : data.authentication
              ? `<div class="metric"><span>Mechanism</span><strong>${escapeHtml(data.authentication.mechanism)}</strong></div><div class="metric"><span>Identity binding</span><strong>${escapeHtml(data.authentication.identityBinding)}</strong></div><div class="metric"><span>Secret in browser</span><strong>${data.authentication.secretReturnedToBrowser ? "YES" : "NO"}</strong></div>`
              : `<p class="gate-detail">Discovery is public. Protected operations authenticate separately.</p>`
        }
      </article>
      <article class="data-card gates">
        <h3>3 · DATA EFFECT</h3>
        <div class="metric"><span>Catalog reads</span><strong>${data.catalogReads ?? 0}</strong></div>
        ${
          data.catalog
            ? data.catalog.products
                .map(
                  (product) =>
                    `<div class="protocol-product"><div><span class="provenance-label">REAL LOCAL DATABASE</span><h4>${escapeHtml(product.title)}</h4><p>${escapeHtml(product.variants[0]?.sku)} · ${escapeHtml(product.categories?.[0]?.value)}</p></div><strong>${money({ currency: product.price_range.min.currency, minorUnits: String(product.price_range.min.amount) })}</strong></div>`,
                )
                .join("")
            : `<p class="gate-detail">${blocked ? "Zero merchant reads: authentication and negotiation happen first." : "Run authenticated catalog to see the real scoped product projection."}</p>`
        }
      </article>
      <article class="data-card gates">
        <h3>WHAT THIS PROVES — AND DOES NOT</h3>
        <div class="metric"><span>Proves</span><strong>Discovery · exact negotiation · identity binding · scope</strong></div>
        <div class="metric"><span>Does not prove</span><strong>Full UCP conformance or production deployment</strong></div>
        <p class="gate-detail">The official schemas and conformance suite remain an explicit later gate. Local HTTP also cannot satisfy public HTTPS hosting rules.</p>
      </article>
    </div>
    <button class="raw-toggle">Show exact response JSON</button>
    <pre class="raw hidden">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  wireRawToggle();
}

function renderEvaluation(data) {
  const report = data.report;
  if (report.schemaVersion === "conduit.red-team-report.v1") {
    renderRedTeam(data);
    return;
  }
  const outcome = report.outcome === "PASS" ? "allow" : "deny";
  result.innerHTML = `
    <div class="result-head">
      <div><p class="eyebrow">VERSIONED EVALUATION</p><h2>${escapeHtml(data.title)}</h2><p>${escapeHtml(data.lesson)}</p></div>
      <span class="outcome ${outcome}">${escapeHtml(report.outcome)}</span>
    </div>
    <div class="result-grid">
      <article class="data-card">
        <h3>EXPECTED BEFORE EXECUTION</h3>
        <div class="metric"><span>Manifest</span><strong>${escapeHtml(data.manifest.suiteId)}</strong></div>
        <div class="metric"><span>Version</span><strong>${escapeHtml(data.manifest.suiteVersion)}</strong></div>
        <div class="metric"><span>Authored</span><strong>${escapeHtml(data.manifest.authoredAt)}</strong></div>
        <div class="metric"><span>Scenarios</span><strong>${data.manifest.scenarios.length}</strong></div>
        <p class="gate-detail">The expected terminal states and facts were loaded before any scenario ran.</p>
      </article>
      <article class="data-card">
        <h3>SUITE RESULT</h3>
        <div class="metric"><span>Passed</span><strong>${report.passedScenarios}</strong></div>
        <div class="metric"><span>Failed</span><strong>${report.failedScenarios}</strong></div>
        <div class="metric"><span>Hard-zero gate</span><strong>${report.hardZeroPassed ? "PASS" : "FAIL"}</strong></div>
        <div class="metric"><span>Generated</span><strong>${escapeHtml(report.generatedAt)}</strong></div>
      </article>
      <article class="data-card gates">
        <h3>HARD-ZERO SAFETY METRICS</h3>
        ${Object.entries(report.hardZero)
          .map(
            ([name, value]) =>
              `<div class="metric"><span>${escapeHtml(humanize(name))}</span><strong class="${value === 0 ? "metric-pass" : "metric-fail"}">${value}</strong></div>`,
          )
          .join("")}
        <p class="gate-detail">These are not percentages. Any value above zero fails the build gate.</p>
      </article>
      <article class="data-card gates">
        <h3>SCENARIO-BY-SCENARIO EVIDENCE</h3>
        ${report.grades.map(evaluationGrade).join("")}
      </article>
    </div>
    <button class="raw-toggle">Show exact response JSON</button>
    <pre class="raw hidden">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  wireRawToggle();
}

function renderRedTeam(data) {
  const report = data.report;
  const variants = [report.guardrailsOn, report.guardrailsOff, ...report.ablations];
  result.innerHTML = `
    <div class="result-head">
      <div><p class="eyebrow">PAIRED RED-TEAM EXPERIMENT</p><h2>${escapeHtml(data.title)}</h2><p>${escapeHtml(data.lesson)}</p></div>
      <span class="outcome ${report.outcome === "PASS" ? "allow" : "deny"}">${escapeHtml(report.outcome)}</span>
    </div>
    <div class="result-grid">
      <article class="data-card gates">
        <h3>WHY THE COMPARISON MATTERS</h3>
        <p class="gate-detail">${escapeHtml(report.statement)}</p>
        <div class="metric"><span>Evidence tier</span><strong>${escapeHtml(report.evidenceTier)}</strong></div>
        <div class="metric"><span>Causal control shown</span><strong>${report.causalControlDemonstrated ? "YES" : "NO"}</strong></div>
      </article>
      <article class="data-card gates">
        <h3>SEVERITY BY CONTROL SET</h3>
        ${variants.map(redTeamVariant).join("")}
      </article>
      <article class="data-card gates">
        <h3>READ THE LEVELS CORRECTLY</h3>
        <div class="metric"><span>L1</span><strong>Behavior altered; expected non-zero</strong></div>
        <div class="metric"><span>L3</span><strong>Data exfiltration; must be zero</strong></div>
        <div class="metric"><span>L4</span><strong>Unauthorized irreversible effect; must be zero</strong></div>
        <p class="gate-detail">Quarantine does not grant or deny authority. Policy, permission narrowing, and redaction contain the effect.</p>
      </article>
    </div>
    <button class="raw-toggle">Show exact response JSON</button>
    <pre class="raw hidden">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  wireRawToggle();
}

function evaluationGrade(grade) {
  return `<div class="call-card"><div class="call-top"><code>${escapeHtml(grade.id)}</code><span class="chip ${grade.passed ? "allow" : "deny"}">${grade.passed ? "PASS" : "FAIL"}</span></div><p class="call-reason"><strong>${escapeHtml(grade.evidenceTier)}</strong> · ${escapeHtml(grade.title)}</p><div class="metric"><span>Expected → observed</span><strong>${escapeHtml(grade.terminal.expected)} → ${escapeHtml(grade.terminal.observed)}</strong></div>${grade.error ? `<p class="unknown-note">${escapeHtml(grade.error)}</p>` : ""}</div>`;
}

function redTeamVariant(variant) {
  const unsafe = variant.severityCounts.L3 > 0 || variant.severityCounts.L4 > 0;
  return `<div class="call-card"><div class="call-top"><code>${escapeHtml(variant.label)}</code><span class="chip ${unsafe ? "deny" : "allow"}">${unsafe ? "ATTACK LANDED" : "CONTAINED"}</span></div><p class="call-reason">Disabled: ${escapeHtml(variant.disabledControls.join(", ") || "none")}</p><div class="severity-row"><span>L1 <strong>${variant.severityCounts.L1}</strong></span><span>L3 <strong>${variant.severityCounts.L3}</strong></span><span>L4 <strong>${variant.severityCounts.L4}</strong></span></div></div>`;
}

function humanize(value) {
  return value.replace(/([A-Z])/g, " $1").toLowerCase();
}

function renderOnboarding(data) {
  const preview = data.preview;
  const rows = preview?.rows ?? [];
  const imported = data.confirmation?.imported ?? 0;
  const skipped =
    data.confirmation?.skipped ??
    rows.filter((row) => row.disposition === "SKIPPED").length;
  const blocked = data.security?.outcome === "BLOCKED";
  const outcome = blocked
    ? { label: "BLOCKED SAFELY", className: "allow" }
    : data.confirmation
      ? { label: `${imported} IMPORTED`, className: "allow" }
      : { label: "PREVIEW ONLY", className: "warn" };
  result.innerHTML = `
    <div class="result-head">
      <div><p class="eyebrow">MERCHANT ONBOARDING</p><h2>${escapeHtml(data.title)}</h2><p>${escapeHtml(data.lesson)}</p></div>
      <span class="outcome ${outcome.className}">${escapeHtml(outcome.label)}</span>
    </div>
    <div class="result-grid">
      ${
        preview
          ? `<article class="data-card">
              <h3>1 · PROPOSED COLUMN MAPPING</h3>
              ${Object.entries(preview.mapping)
                .filter(([key]) => key !== "attributeColumns")
                .map(
                  ([field, column]) =>
                    `<div class="metric"><span>${escapeHtml(field)}</span><strong>${escapeHtml(column ?? "DEFAULT")}</strong></div>`,
                )
                .join("")}
              <div class="confirmation">Confirmation fingerprint ${escapeHtml(shortHash(preview.confirmationFingerprint))}</div>
            </article>`
          : ""
      }
      ${
        preview
          ? `<article class="data-card gates">
              <h3>2 · ROW-BY-ROW PREVIEW</h3>
              ${rows.map(importRow).join("")}
              <div class="audit-summary"><span class="chip allow">${rows.filter((row) => row.disposition === "READY" || row.disposition === "IMPORTED").length} READY</span><span class="chip warn">${skipped} SKIPPED</span></div>
            </article>`
          : ""
      }
      ${
        data.security
          ? `<article class="data-card gates">
              <h3>REDIRECT SECURITY TRACE</h3>
              <div class="metric"><span>Outcome</span><strong>${escapeHtml(data.security.outcome)}</strong></div>
              <div class="metric"><span>Network connections</span><strong>${data.security.transportCalls}</strong></div>
              <p class="unknown-note">${escapeHtml(data.security.refusal)}</p>
              <p class="gate-detail">${escapeHtml(data.security.lesson)}</p>
            </article>`
          : ""
      }
      ${
        data.catalog
          ? `<article class="data-card gates">
              <h3>3 · TRUSTED / UNTRUSTED CATALOG</h3>
              ${data.catalog.products.map(catalogProduct).join("")}
            </article>
            <article class="data-card gates">
              <h3>FIELD PROVENANCE</h3>
              ${data.catalog.provenance.map((source) => `<div class="discovery-row"><code>${escapeHtml(source.sku)}.${escapeHtml(source.field_name)}</code><span>${escapeHtml(source.source_type)} · ${escapeHtml(source.source_path)}</span></div>`).join("")}
            </article>`
          : ""
      }
      ${
        data.protectedExistingPrice
          ? `<article class="data-card"><h3>MERGE-ONLY PROOF</h3><div class="metric"><span>Existing price versions</span><strong>${data.protectedExistingPrice.length}</strong></div><div class="metric"><span>Protected price</span><strong>${money(data.protectedExistingPrice[0])}</strong></div><p class="gate-detail">The ₹1.00 file row was recorded as EXISTING_SKU and never became a price update.</p></article>`
          : ""
      }
      ${
        data.enrichment
          ? `<article class="data-card"><h3>HUMAN REVIEW GATE</h3><div class="metric"><span>Initial status</span><strong>${escapeHtml(data.enrichment.proposal.status)}</strong></div><div class="metric"><span>Before review</span><strong>${escapeHtml(JSON.stringify(data.enrichment.beforeReview))}</strong></div><div class="metric"><span>Human decision</span><strong>${escapeHtml(data.enrichment.reviewed.status)}</strong></div><div class="metric"><span>After review</span><strong>${escapeHtml(JSON.stringify(data.enrichment.afterReview))}</strong></div></article>`
          : ""
      }
      ${
        data.databaseMutated === false
          ? `<article class="data-card"><h3>DRY-RUN INVARIANT</h3><div class="metric"><span>Products written</span><strong>${data.productCount}</strong></div><p class="gate-detail">Preview is durable evidence, but it cannot create catalog products.</p></article>`
          : ""
      }
    </div>
    <button class="raw-toggle">Show exact response JSON</button>
    <pre class="raw hidden">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  wireRawToggle();
}

function importRow(row) {
  const style = row.disposition === "SKIPPED" ? "deny" : "allow";
  return `<div class="call-card"><div class="call-top"><code>ROW ${row.rowNumber} · ${escapeHtml(row.normalized?.sku ?? "REJECTED")}</code><span class="chip ${style}">${escapeHtml(row.disposition)}</span></div><p class="call-reason">${escapeHtml(row.reasonCode ?? "VALIDATED")} — ${escapeHtml(row.explanation ?? "Ready for explicit confirmation")}</p></div>`;
}

function catalogProduct(product) {
  return `<div class="catalog-split"><div><span class="provenance-label">STRUCTURED TRUTH</span><pre>${escapeHtml(JSON.stringify(product.structured, null, 2))}</pre></div><div class="untrusted"><span class="provenance-label">MERCHANT PROSE · UNTRUSTED</span><pre>${escapeHtml(JSON.stringify(product.untrusted, null, 2))}</pre></div></div>`;
}

function renderAgent(data) {
  if (data.availability === "NOT_CONFIGURED") {
    result.innerHTML = `
      <div class="result-head">
        <div><p class="eyebrow">LIVE ADAPTER</p><h2>${escapeHtml(data.title)}</h2><p>${escapeHtml(data.lesson)}</p></div>
        <span class="outcome warn">SETUP NEEDED</span>
      </div>
      <div class="result-grid"><article class="data-card gates"><h3>HOW TO ENABLE IT</h3><p class="gate-detail">Set <code>OPENAI_API_KEY</code> and <code>OPENAI_MODEL</code> in your local <code>.env</code>, then restart the demo. The key stays server-side.</p></article></div>`;
    return;
  }
  const run = data.run ?? {};
  const outcome = agentOutcome(run.state);
  const proposal = data.proposal?.proposal;
  result.innerHTML = `
    <div class="result-head">
      <div><p class="eyebrow">BOUNDED AGENT RUN</p><h2>${escapeHtml(data.title)}</h2><p>${escapeHtml(data.lesson)}</p></div>
      <span class="outcome ${outcome.className}">${escapeHtml(outcome.label)}</span>
    </div>
    <div class="result-grid">
      <article class="data-card">
        <h3>1 · TYPED INTENT</h3>
        ${
          proposal
            ? `
          <div class="metric"><span>Summary</span><strong>${escapeHtml(proposal.summary)}</strong></div>
          <div class="metric"><span>Maximum</span><strong>${money({ currency: proposal.currency, minorUnits: proposal.maximumMinorUnits })}</strong></div>
          <div class="metric"><span>Quantity</span><strong>${proposal.quantity}</strong></div>
          <div class="metric"><span>Excluded</span><strong>${escapeHtml(proposal.excludedTerms.join(", ") || "None")}</strong></div>
          <div class="confirmation">✓ Human confirmed fingerprint ${escapeHtml(shortHash(data.proposal.fingerprint))}</div>
        `
            : `<p class="gate-detail">The proposed intent failed schema validation, so confirmation and tools never started.</p>`
        }
      </article>
      <article class="data-card">
        <h3>MODEL STRATEGY</h3>
        <div class="metric"><span>Adapter</span><strong>${escapeHtml(run.modelId ?? "—")}</strong></div>
        <div class="metric"><span>Claim</span><strong>${escapeHtml(data.claimLevel)}</strong></div>
        <div class="metric"><span>Steps used</span><strong>${run.stepsUsed ?? 0} / 6</strong></div>
        <p class="gate-detail">Changing the model does not change the boundary, money rules, or tool permissions.</p>
      </article>
      <article class="data-card gates">
        <h3>2 · EXPLICIT STATE MACHINE</h3>
        ${(run.events ?? []).map(agentEvent).join("") || `<p class="gate-detail">No state transition occurred before validation failed.</p>`}
      </article>
      <article class="data-card gates">
        <h3>3 · BOUNDARY-CHECKED TOOLS</h3>
        ${(data.boundaryCalls ?? []).map(callCard).join("") || `<p class="gate-detail">Zero tools were called.</p>`}
      </article>
      <article class="data-card">
        <h3>AUTHORITATIVE MONEY RESULT</h3>
        <div class="metric"><span>Server cart total</span><strong>${run.cart ? money({ currency: run.cart.currency, minorUnits: run.cart.totalMinorUnits }) : "—"}</strong></div>
        <div class="metric"><span>Commit outcome</span><strong>${escapeHtml(run.commit?.outcome ?? "NO COMMIT")}</strong></div>
        <div class="metric"><span>Charged</span><strong>${run.commit?.chargedMinorUnits ? money({ currency: run.cart.currency, minorUnits: run.commit.chargedMinorUnits }) : "NOTHING"}</strong></div>
        ${run.failureReason ? `<p class="unknown-note">${escapeHtml(run.failureReason)}</p>` : ""}
      </article>
      <article class="data-card">
        <h3>AUDIT EVIDENCE</h3>
        <div class="metric"><span>Boundary events</span><strong>${data.audit?.entryCount ?? 0}</strong></div>
        <div class="metric"><span>Hash chain</span><strong>${data.audit?.verification.valid ? "VERIFIED" : data.audit ? "BROKEN" : "NOT STARTED"}</strong></div>
        <p class="gate-detail">Each forwarded or blocked tool proposal leaves a decision and outcome record.</p>
      </article>
    </div>
    <button class="raw-toggle">Show exact response JSON</button>
    <pre class="raw hidden">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  wireRawToggle();
}

function agentEvent(event) {
  return `<div class="agent-event"><span class="audit-sequence">${String(event.sequence).padStart(2, "0")}</span><span><strong>${escapeHtml(event.state)}</strong><small>${escapeHtml(event.type)} · ${escapeHtml(event.detail)}</small></span></div>`;
}

function agentOutcome(state) {
  if (state === "SUCCEEDED") return { label: "SUCCEEDED", className: "allow" };
  if (state === "REQUIRES_APPROVAL")
    return { label: "REQUIRE APPROVAL", className: "warn" };
  if (state === "REFUSED") return { label: "SAFE REFUSAL", className: "warn" };
  return { label: state ?? "FAILED", className: "deny" };
}

function renderCommerce(data) {
  const decision = data.result?.decision;
  const outcome = finalOutcome(data);
  const gates = data.result?.gates ?? [];
  const liveQuote = data.result?.liveQuote;
  const evidence = data.evidence;
  result.innerHTML = `
    <div class="result-head">
      <div><p class="eyebrow">EXECUTION RESULT</p><h2>${escapeHtml(data.title)}</h2><p>${escapeHtml(data.lesson)}</p></div>
      <span class="outcome ${outcome.className}">${escapeHtml(outcome.label)}</span>
    </div>
    <div class="result-grid">
      ${quoteCard("AGENT'S CLAIMED QUOTE", data.claimedQuote)}
      ${quoteCard("SERVER'S LIVE QUOTE", liveQuote)}
      <article class="data-card gates">
        <h3>ORDERED COMMIT GATE</h3>
        ${gates.map(gateRow).join("") || `<p class="gate-detail">No side-effecting gate ran.</p>`}
      </article>
      <article class="data-card">
        <h3>POLICY DECISION</h3>
        <div class="metric"><span>Outcome</span><strong>${escapeHtml(decision?.outcome ?? "—")}</strong></div>
        <div class="metric"><span>Reason code</span><strong>${escapeHtml(decision?.reason ?? "—")}</strong></div>
        <div class="metric"><span>Recovery</span><strong>${escapeHtml(decision?.recoveryAction ?? "None needed")}</strong></div>
      </article>
      <article class="data-card">
        <h3>DURABLE DATABASE EVIDENCE</h3>
        ${
          evidence
            ? `
          <div class="metric"><span>Operation</span><strong>${escapeHtml(evidence.operation_status)}</strong></div>
          <div class="metric"><span>Order</span><strong>${escapeHtml(evidence.order_status)}</strong></div>
          <div class="metric"><span>Stock</span><strong>${escapeHtml(evidence.stock_status)}</strong></div>
          <div class="metric"><span>Outbox</span><strong>${escapeHtml(evidence.outbox_status)} · ${evidence.attempts} call</strong></div>
          <div class="metric"><span>Ledger</span><span class="ledger">${ledger(evidence.ledger_entries)}</span></div>
        `
            : `<p class="gate-detail">No rows were written. The request stopped safely before side effects.</p>`
        }
        ${data.unknownEvidence ? `<div class="unknown-note">At the timeout boundary the operation was <strong>${escapeHtml(data.unknownEvidence.operation_status)}</strong>. CONDUIT kept both reservations, queried provider state, then moved to ${escapeHtml(evidence.operation_status)} without authorizing twice.</div>` : ""}
      </article>
    </div>
    <button class="raw-toggle">Show exact response JSON</button>
    <pre class="raw hidden">${escapeHtml(JSON.stringify(data, null, 2))}</pre>
  `;
  wireRawToggle();
}

function renderBoundary(data) {
  const lastCall = data.calls.at(-1);
  const decision = lastCall?.decision ?? {};
  const outcome = boundaryOutcome(decision);
  const trustChanged = data.calls.some(
    (call) => call.beforeTrustState !== call.afterTrustState,
  );
  const firstResult = data.calls.find((call) => call.result)?.result;
  result.innerHTML = `
    <div class="result-head">
      <div><p class="eyebrow">BOUNDARY EXECUTION</p><h2>${escapeHtml(data.title)}</h2><p>${escapeHtml(data.lesson)}</p></div>
      <span class="outcome ${outcome.className}">${escapeHtml(outcome.label)}</span>
    </div>
    <div class="result-grid">
      <article class="data-card">
        <h3>RUN TRUST STATE</h3>
        <div class="trust-flow">
          <div class="trust-state"><span>Before</span><strong>${escapeHtml(data.calls[0]?.beforeTrustState ?? data.run.trustState)}</strong></div>
          <span>→</span>
          <div class="trust-state ${trustChanged ? "quarantined" : ""}"><span>After</span><strong>${escapeHtml(data.calls.at(-1)?.afterTrustState ?? data.run.trustState)}</strong></div>
        </div>
        <div class="metric"><span>Policy</span><strong>${escapeHtml(data.run.policyVersion)}</strong></div>
        <div class="metric"><span>Fresh marker</span><strong>${escapeHtml(shortHash(data.run.quarantineNonce))}</strong></div>
      </article>
      <article class="data-card">
        <h3>RUNTIME DISCOVERY</h3>
        ${data.discovery.map(discoveryRow).join("")}
      </article>
      <article class="data-card gates">
        <h3>INTERCEPTED TOOL CALLS</h3>
        ${data.calls.map(callCard).join("")}
      </article>
      <article class="data-card">
        <h3>TRUST-LABELLED OUTPUT</h3>
        ${
          firstResult
            ? `
          <div class="provenance-block"><span class="provenance-label">${escapeHtml(firstResult.structured.label)}</span><pre>${escapeHtml(JSON.stringify(firstResult.structured.value, null, 2))}</pre></div>
          ${firstResult.quarantinedText.map((item) => `<div class="provenance-block untrusted"><span class="provenance-label">${escapeHtml(item.label)} · DATA, NEVER INSTRUCTION</span><pre>${escapeHtml(String(item.value))}</pre></div>`).join("")}
        `
            : `<p class="gate-detail">No tool output was forwarded. The call stopped at the boundary.</p>`
        }
      </article>
      <article class="data-card">
        <h3>PRIVACY INVARIANT</h3>
        <div class="metric"><span>Raw seeded PII visible</span><strong>${data.audit.rawPiiPresent ? "YES — FAILURE" : "NO"}</strong></div>
        <div class="metric"><span>Operator context</span><strong>${escapeHtml(data.operatorContext.value)}</strong></div>
        <p class="gate-detail">Sensitive values are tokenized before responses and audit persistence.</p>
      </article>
      <article class="data-card gates">
        <h3>TAMPER-EVIDENT AUDIT CHAIN</h3>
        <div class="audit-summary">
          <span class="chip ${data.audit.verification.valid ? "allow" : "deny"}">${data.audit.verification.valid ? "CHAIN VERIFIED" : "CHAIN BROKEN"}</span>
          <span class="chip">${data.audit.verification.entryCount} ENTRIES</span>
          <span class="chip">HEAD ${escapeHtml(shortHash(data.audit.verification.headHash))}</span>
        </div>
        ${data.audit.entries.map(auditRow).join("")}
      </article>
    </div>
    <button class="raw-toggle">Show exact response JSON</button>
    <pre class="raw hidden">${escapeHtml(JSON.stringify(data, null, 2))}</pre>
  `;
  wireRawToggle();
}

function discoveryRow(tool) {
  const style =
    tool.status === "APPROVED"
      ? "allow"
      : tool.status === "SCHEMA_DRIFT"
        ? "deny"
        : "warn";
  return `<div class="discovery-row"><code>${escapeHtml(tool.toolName)}</code><span class="chip ${style}">${escapeHtml(tool.status)}</span></div>`;
}

function callCard(call, index) {
  const decision = call.decision;
  const style =
    decision.outcome === "ALLOW"
      ? "allow"
      : decision.outcome === "DENY"
        ? "deny"
        : "warn";
  return `<div class="call-card">
    <div class="call-top"><code>${String(index + 1).padStart(2, "0")} · ${escapeHtml(call.reconciliation.toolName)}</code><span class="chip ${style}">${escapeHtml(decision.outcome)}</span></div>
    <p class="call-reason"><strong>${escapeHtml(decision.reason)}</strong> — ${escapeHtml(decision.explanation)}</p>
    <div class="metric"><span>Schema</span><strong>${escapeHtml(call.reconciliation.status)}</strong></div>
    <div class="metric"><span>Forwarded</span><strong>${call.forwarded ? "YES" : "NO"}</strong></div>
  </div>`;
}

function auditRow(entry) {
  return `<div class="audit-entry"><span class="audit-sequence">#${entry.sequence}</span><span class="audit-phase">${escapeHtml(entry.phase)}</span><span class="audit-tool">${escapeHtml(entry.toolName)} · ${escapeHtml(entry.reason)}</span><span class="audit-hash">${escapeHtml(shortHash(entry.entryHash))}</span></div>`;
}

function boundaryOutcome(decision) {
  if (decision.outcome === "ALLOW") return { label: "ALLOWED", className: "allow" };
  if (decision.outcome === "DENY") return { label: "DENIED", className: "deny" };
  return { label: "REQUIRE APPROVAL", className: "warn" };
}

function shortHash(value) {
  if (!value) return "—";
  return `${String(value).slice(0, 8)}…${String(value).slice(-6)}`;
}

function wireRawToggle() {
  const toggle = result.querySelector(".raw-toggle");
  const raw = result.querySelector(".raw");
  toggle.addEventListener("click", () => {
    raw.classList.toggle("hidden");
    toggle.textContent = raw.classList.contains("hidden")
      ? "Show exact response JSON"
      : "Hide exact response JSON";
  });
}

function quoteCard(title, quote) {
  if (!quote)
    return `<article class="data-card"><h3>${title}</h3><p class="gate-detail">Not available</p></article>`;
  return `<article class="data-card"><h3>${title}</h3>
    ${quote.lines.map((line) => `<div class="quote-line"><span>${escapeHtml(line.sku)} · ${line.quantity} × ${money(line.unitPrice)}</span><strong>${money(line.lineTotal)}</strong></div>`).join("")}
    <div class="quote-total"><span>Total</span><strong>${money(quote.statedTotal)}</strong></div>
  </article>`;
}

function gateRow(gate) {
  const style = gate.status.toLowerCase();
  const mark = gate.status === "PASS" ? "✓" : gate.status === "WARN" ? "!" : "×";
  return `<div class="gate ${style}"><span class="gate-mark">${mark}</span><span class="gate-name">${escapeHtml(gate.key)}</span><span class="gate-detail">${escapeHtml(gate.detail)}</span></div>`;
}

function ledger(entries = []) {
  return (
    entries
      .map(
        (entry, index) =>
          `${index ? '<span class="ledger-arrow">→</span>' : ""}<span class="ledger-entry">${escapeHtml(entry)}</span>`,
      )
      .join("") || "—"
  );
}

function finalOutcome(data) {
  const status = data.evidence?.operation_status;
  if (status === "CONFIRMED") return { label: "CONFIRMED", className: "allow" };
  if (data.result?.outcome === "REQUIRES_APPROVAL")
    return { label: "REQUIRE APPROVAL", className: "warn" };
  if (data.result?.outcome === "DENIED") return { label: "DENIED", className: "deny" };
  return { label: status ?? data.result?.outcome ?? "COMPLETE", className: "warn" };
}

function money(value) {
  if (!value) return "—";
  const amount = Number(value.minorUnits) / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: value.currency,
  }).format(amount);
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ],
  );
}
