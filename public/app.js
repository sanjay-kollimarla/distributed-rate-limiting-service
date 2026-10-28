// Demo UI for the rate limiter. Plain ES modules, no build step, no dependencies.
// Every number shown comes from a real response from this server.

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sessionId = Math.random().toString(36).slice(2, 8);

const ENDPOINTS = {
  resource: { method: "GET", path: "/api/resource" },
  orders: { method: "POST", path: "/api/orders" },
};

const MAX_TOTAL_RPS = 500; // keeps a public demo from exhausting a free-tier Redis

const PRESETS = {
  steady: { clients: 100, rps: 3, seconds: 10, tier: "anonymous", shared: false },
  abusive: { clients: 1, rps: 50, seconds: 10, tier: "anonymous", shared: false },
  crowd: { clients: 200, rps: 2, seconds: 10, tier: "standard", shared: false },
};

// ---------------------------------------------------------------- requests

async function sendRequest({ endpoint, clientId, tier }) {
  const init = { method: endpoint.method, headers: { "x-demo-client-id": clientId, "x-demo-tier": tier } };
  if (endpoint.method === "POST") {
    init.headers["content-type"] = "application/json";
    init.body = "{}";
  }

  const startedAt = performance.now();
  try {
    const res = await fetch(endpoint.path, init);
    await res.arrayBuffer();
    const header = (name) => res.headers.get(name);
    return {
      status: res.status,
      ms: performance.now() - startedAt,
      limit: Number(header("ratelimit-limit")),
      remaining: Number(header("ratelimit-remaining")),
      retryAfter: Number(header("retry-after")) || 0,
      policy: header("x-ratelimit-policy") ?? "–",
      requestId: header("x-request-id") ?? "–",
    };
  } catch {
    return { status: 0, ms: performance.now() - startedAt, limit: NaN, remaining: NaN, retryAfter: 0, policy: "–" };
  }
}

function resultOf(status) {
  if (status === 200 || status === 201) return { label: `${status} allowed`, cls: "ok" };
  if (status === 429) return { label: "429 limited", cls: "deny" };
  return { label: status === 0 ? "network error" : String(status), cls: "err" };
}

// ------------------------------------------------------------ 1. try it

const tryState = { clientSeq: 0, retryTimer: undefined };
const tryClientId = () => `${sessionId}-try-${tryState.clientSeq}`;

function addLogRow(response) {
  const { label, cls } = resultOf(response.status);
  const row = document.createElement("tr");
  const badge = document.createElement("span");
  badge.className = `badge ${cls}`;
  badge.textContent = label;

  const cells = [
    new Date().toLocaleTimeString(),
    badge,
    Number.isNaN(response.remaining) ? "–" : String(response.remaining),
    response.policy,
    `${response.ms.toFixed(0)} ms`,
    (response.requestId ?? "–").slice(0, 8),
  ];
  for (const content of cells) {
    const cell = document.createElement("td");
    cell.append(content);
    row.append(cell);
  }

  const log = $("log");
  log.prepend(row);
  while (log.children.length > 12) log.lastElementChild.remove();
}

function showGauge(response) {
  if (Number.isNaN(response.limit)) {
    $("gauge-status").textContent = "Request failed. Is the server running?";
    return;
  }
  $("gauge-remaining").textContent = String(response.remaining);
  $("gauge-limit").textContent = String(response.limit);
  const bar = $("gauge-bar");
  bar.style.width = `${(response.remaining / response.limit) * 100}%`;
  bar.classList.toggle("denied", response.status === 429);

  clearInterval(tryState.retryTimer);
  if (response.status === 429) {
    const until = performance.now() + response.retryAfter * 1000;
    const tick = () => {
      const left = Math.max(0, (until - performance.now()) / 1000);
      $("gauge-status").textContent =
        left > 0 ? `Rate limited. Retry in ${left.toFixed(1)}s.` : "Window passed: you can send again.";
      if (left === 0) clearInterval(tryState.retryTimer);
    };
    tick();
    tryState.retryTimer = setInterval(tick, 100);
  } else {
    $("gauge-status").textContent = `Allowed under policy ${response.policy}.`;
  }
}

async function sendOne() {
  const response = await sendRequest({
    endpoint: ENDPOINTS[$("try-endpoint").value],
    clientId: tryClientId(),
    tier: $("try-tier").value,
  });
  addLogRow(response);
  showGauge(response);
}

async function sendBurst(count) {
  const buttons = [$("try-send"), $("try-burst")];
  for (const button of buttons) button.disabled = true;
  for (let i = 0; i < count; i++) await sendOne();
  for (const button of buttons) button.disabled = false;
}

function resetIdentity() {
  tryState.clientSeq += 1;
  clearInterval(tryState.retryTimer);
  $("log").replaceChildren();
  $("gauge-remaining").textContent = "–";
  $("gauge-limit").textContent = "–";
  $("gauge-bar").style.width = "0";
  $("gauge-status").textContent = "New client identity, full allowance. Send a request to begin.";
}

// ------------------------------------------------------------ 2. load test

const HISTOGRAM_MAX_MS = 2000;
const load = { running: false, stop: false, runSeq: 0, lastRun: undefined };

function newRun(config) {
  return {
    config,
    startedAt: performance.now(),
    sent: 0,
    allowed: 0,
    denied: 0,
    errors: 0,
    perSecond: [],
    latency: new Uint32Array(HISTOGRAM_MAX_MS + 1),
  };
}

function record(run, response) {
  const second = Math.floor((performance.now() - run.startedAt) / 1000);
  const bucket = run.perSecond[second] ?? { allowed: 0, denied: 0, errors: 0 };
  run.perSecond[second] = bucket;
  run.sent += 1;
  run.latency[Math.min(HISTOGRAM_MAX_MS, Math.round(response.ms))] += 1;
  if (response.status === 200 || response.status === 201) {
    run.allowed += 1;
    bucket.allowed += 1;
  } else if (response.status === 429) {
    run.denied += 1;
    bucket.denied += 1;
  } else {
    run.errors += 1;
    bucket.errors += 1;
  }
}

function percentile(histogram, total, fraction) {
  if (total === 0) return undefined;
  const target = Math.ceil(total * fraction);
  let seen = 0;
  for (let ms = 0; ms < histogram.length; ms++) {
    seen += histogram[ms];
    if (seen >= target) return ms;
  }
  return HISTOGRAM_MAX_MS;
}

async function clientLoop(run, index, endsAt) {
  const { rps, tier, shared } = run.config;
  const clientId = shared ? `${sessionId}-load-${load.runSeq}-shared` : `${sessionId}-load-${load.runSeq}-${index}`;
  const interval = 1000 / rps;
  let next = performance.now() + Math.random() * interval; // spread clients so they do not fire in lockstep

  while (!load.stop && performance.now() < endsAt) {
    const wait = next - performance.now();
    if (wait > 0) await sleep(wait);
    next = Math.max(next + interval, performance.now() - interval * 5); // do not burst to catch up
    record(run, await sendRequest({ endpoint: ENDPOINTS.resource, clientId, tier }));
  }
}

function renderStats(run) {
  const elapsed = Math.max(0.001, (performance.now() - run.startedAt) / 1000);
  $("stat-sent").textContent = run.sent.toLocaleString();
  $("stat-rps").textContent = Math.round(run.sent / elapsed).toLocaleString();
  $("stat-allowed").textContent = run.allowed.toLocaleString();
  $("stat-denied").textContent = run.denied.toLocaleString();
  $("stat-errors").textContent = run.errors.toLocaleString();
  for (const [id, fraction] of [
    ["stat-p50", 0.5],
    ["stat-p95", 0.95],
    ["stat-p99", 0.99],
  ]) {
    const value = percentile(run.latency, run.sent, fraction);
    $(id).textContent = value === undefined ? "–" : `${value} ms`;
  }
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawChart(run) {
  const canvas = $("chart");
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);

  const seconds = run ? Math.max(run.config.seconds, 1) : 10;
  const data = run ? run.perSecond : [];
  const peak = Math.max(10, ...data.map((b) => (b ? b.allowed + b.denied + b.errors : 0)));
  const pad = { left: 44, right: 10, top: 10, bottom: 20 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const slot = plotW / seconds;

  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = cssVar("--muted");
  ctx.strokeStyle = cssVar("--line");
  ctx.textAlign = "right";
  for (const fraction of [0, 0.5, 1]) {
    const y = pad.top + plotH * (1 - fraction);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(String(Math.round(peak * fraction)), pad.left - 6, y + 4);
  }
  ctx.textAlign = "center";
  ctx.fillText("seconds", pad.left + plotW / 2, height - 4);

  for (let s = 0; s < seconds; s++) {
    const bucket = data[s];
    if (!bucket) continue;
    let y = pad.top + plotH;
    for (const [count, color] of [
      [bucket.allowed, "--ok"],
      [bucket.denied, "--deny"],
      [bucket.errors, "--err"],
    ]) {
      const h = (count / peak) * plotH;
      ctx.fillStyle = cssVar(color);
      ctx.fillRect(pad.left + s * slot + 1, y - h, Math.max(1, slot - 2), h);
      y -= h;
    }
  }
}

function setRunning(running) {
  load.running = running;
  $("load-start").disabled = running;
  $("load-stop").disabled = !running;
}

function readLoadConfig() {
  const int = (id, min, max) => Math.min(max, Math.max(min, Math.floor(Number($(id).value)) || min));
  const clients = int("load-clients", 1, 500);
  const rps = Math.min(int("load-rps", 1, 100), Math.max(1, Math.floor(MAX_TOTAL_RPS / clients)));
  return {
    clients,
    rps,
    seconds: int("load-seconds", 3, 20),
    tier: $("load-tier").value,
    shared: $("load-shared").checked,
  };
}

async function startLoad() {
  if (load.running) return;
  const config = readLoadConfig();
  load.runSeq += 1;
  load.stop = false;
  setRunning(true);

  const run = newRun(config);
  load.lastRun = run;
  const target = config.clients * config.rps;
  $("load-status").textContent =
    `Running: ${config.clients} ${config.shared ? "clients sharing one identity" : "separate clients"} ` +
    `at ${config.rps}/s each (target ${target.toLocaleString()} req/s) for ${config.seconds}s.`;

  const timer = setInterval(() => {
    renderStats(run);
    drawChart(run);
  }, 250);

  const endsAt = run.startedAt + config.seconds * 1000;
  await Promise.all(Array.from({ length: config.clients }, (_, index) => clientLoop(run, index, endsAt)));

  clearInterval(timer);
  renderStats(run);
  drawChart(run);
  const share = run.sent === 0 ? 0 : Math.round((run.denied / run.sent) * 100);
  $("load-status").textContent =
    `${load.stop ? "Stopped" : "Finished"}: ${run.sent.toLocaleString()} requests, ${share}% were rate limited.`;
  setRunning(false);
}

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset || load.running) return;
  $("load-clients").value = preset.clients;
  $("load-rps").value = preset.rps;
  $("load-seconds").value = preset.seconds;
  $("load-tier").value = preset.tier;
  $("load-shared").checked = preset.shared;
  startLoad();
}

// ------------------------------------------------------ 3. server metrics

const DECISION_LINE = /^rate_limit_decisions_total\{policy="((?:[^"\\]|\\.)*)",outcome="(allowed|denied)"\} (\d+)$/;

function parseMetrics(text) {
  const byPolicy = new Map();
  let failures = 0;
  for (const line of text.split("\n")) {
    const decision = DECISION_LINE.exec(line);
    if (decision) {
      const [, policy, outcome, count] = decision;
      const counts = byPolicy.get(policy) ?? { allowed: 0, denied: 0 };
      counts[outcome] = Number(count);
      byPolicy.set(policy, counts);
    } else if (line.startsWith("rate_limit_store_failures_total ")) {
      failures = Number(line.split(" ")[1]);
    }
  }
  return { byPolicy, failures };
}

async function refreshMetrics() {
  const body = $("metrics-body");
  try {
    const res = await fetch("/metrics");
    if (res.status === 401) {
      body.replaceChildren(messageRow("Metrics are protected by METRICS_TOKEN on this server."));
      return;
    }
    const { byPolicy, failures } = parseMetrics(await res.text());
    $("metrics-failures").textContent = String(failures);
    if (byPolicy.size === 0) {
      body.replaceChildren(messageRow("No decisions yet. Send a request above."));
      return;
    }
    body.replaceChildren(
      ...[...byPolicy].map(([policy, counts]) => {
        const row = document.createElement("tr");
        for (const value of [policy, counts.allowed.toLocaleString(), counts.denied.toLocaleString()]) {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.append(cell);
        }
        return row;
      }),
    );
  } catch {
    body.replaceChildren(messageRow("Could not reach /metrics."));
  }
}

function messageRow(text) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 3;
  cell.className = "muted";
  cell.textContent = text;
  row.append(cell);
  return row;
}

async function refreshReadiness() {
  const chip = $("chip-store");
  try {
    const { dependencies, storeKind } = await (await fetch("/ready")).json();
    const up = dependencies.store === "up";
    const name = storeKind === "redis" ? "Redis" : "in-memory, single instance";
    chip.textContent = up ? `store: ${name} up` : `store: ${name} down, failing open`;
    chip.className = `chip ${up ? "up" : "down"}`;
  } catch {
    chip.textContent = "server unreachable";
    chip.className = "chip down";
  }
}

// ------------------------------------------------------------------ wiring

$("try-send").addEventListener("click", sendOne);
$("try-burst").addEventListener("click", () => sendBurst(30));
$("try-reset").addEventListener("click", resetIdentity);
$("load-start").addEventListener("click", startLoad);
$("load-stop").addEventListener("click", () => {
  load.stop = true;
});
for (const button of document.querySelectorAll("[data-preset]")) {
  button.addEventListener("click", () => applyPreset(button.dataset.preset));
}
window.addEventListener("resize", () => drawChart(load.lastRun));

drawChart(undefined);
refreshReadiness();
refreshMetrics();
setInterval(refreshReadiness, 5000);
setInterval(refreshMetrics, 2000);

// Shareable deep links: /?demo=burst, /?demo=steady, /?demo=abusive, /?demo=crowd
const autorun = new URLSearchParams(location.search).get("demo");
if (autorun === "burst") sendBurst(30);
else if (autorun) applyPreset(autorun);
