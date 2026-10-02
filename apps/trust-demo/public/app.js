const buttons = [...document.querySelectorAll(".scenario")];
const runButton = document.querySelector("#run-button");
const empty = document.querySelector("#empty-state");
const loading = document.querySelector("#loading-state");
const result = document.querySelector("#result");
let selected = "authorized";

for (const button of buttons) {
  button.addEventListener("click", () => {
    selected = button.dataset.scenario;
    for (const candidate of buttons)
      candidate.classList.toggle("active", candidate === button);
    runButton.firstChild.textContent = `Run ${button.querySelector("strong").textContent.toLowerCase()} `;
  });
}

runButton.addEventListener("click", async () => {
  runButton.disabled = true;
  empty.classList.add("hidden");
  result.classList.add("hidden");
  loading.classList.remove("hidden");
  try {
    const response = await fetch(`/api/scenarios/${selected}`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Scenario failed");
    render(data);
  } catch (error) {
    result.innerHTML = `<div class="error"><h3>Scenario failed</h3><p>${escapeHtml(error.message)}</p></div>`;
  } finally {
    loading.classList.add("hidden");
    result.classList.remove("hidden");
    runButton.disabled = false;
  }
});

function render(data) {
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
