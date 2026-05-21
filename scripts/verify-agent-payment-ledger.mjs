import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const failures = [];

const pagePath = "public/agent-payments/signal-ledger/index.html";
const feedPath = "public/agent-payments/signal-ledger/feed.json";
const previousFeedPath = "public/agent-payments/signal-ledger/feed.previous.json";
const snapshotScriptPath = "scripts/snapshot-agent-payment-ledger-feed.mjs";

const [pageHtml, feedJson, previousFeedJson, snapshotScript, homeHtml, projectsJson, sitemapXml] = await Promise.all([
  readOptional(pagePath),
  readOptional(feedPath),
  readOptional(previousFeedPath),
  readOptional(snapshotScriptPath),
  read("index.html"),
  read("src/data/projects.json"),
  read("public/sitemap.xml"),
]);

const feed = parseJson(feedJson, feedPath) ?? {};
const previousFeed = parseJson(previousFeedJson, previousFeedPath) ?? {};
const projects = JSON.parse(projectsJson);

const ledgerUrl = "https://bortlesboat.github.io/agent-payments/signal-ledger/";
const feedUrl = `${ledgerUrl}feed.json`;
const previousFeedUrl = `${ledgerUrl}feed.previous.json`;
const allowedProofStatuses = new Set([
  "live-discovery",
  "paid-call-captured",
  "public-proof-packet",
  "ecosystem-listed",
  "public-observatory",
  "protocol-doc",
  "platform-doc",
]);
const allowedChangeStatuses = new Set(["baseline", "changed", "unchanged", "reverify-first"]);

if (feed.title !== "Agent Payment Signal Ledger") {
  failures.push("feed.title must be Agent Payment Signal Ledger");
}

if (feed.url !== ledgerUrl) {
  failures.push(`feed.url must be ${ledgerUrl}`);
}

if (feed.feedUrl !== feedUrl) {
  failures.push(`feed.feedUrl must be ${feedUrl}`);
}

if (feed.previousFeedUrl !== previousFeedUrl) {
  failures.push(`feed.previousFeedUrl must be ${previousFeedUrl}`);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(feed.lastUpdated ?? "")) {
  failures.push("feed.lastUpdated must be YYYY-MM-DD");
}

if (!Array.isArray(feed.rows) || feed.rows.length < 10) {
  failures.push("feed.rows must contain at least 10 rows");
}

if (!Array.isArray(previousFeed.rows) || previousFeed.rows.length < 10) {
  failures.push("previous feed must contain at least 10 rows");
}

for (const token of [
  "feed.json",
  "feed.previous.json",
  "--write",
  "snapshot",
  "readFile",
  "writeFile",
]) {
  if (!snapshotScript.includes(token)) {
    failures.push(`${snapshotScriptPath} is missing ${token}`);
  }
}

const refreshDelta = feed.refreshDelta ?? {};
for (const key of ["currentRefreshDate", "previousRefreshDate", "summary", "changedRowCount", "reverifyFirstRowCount"]) {
  if (refreshDelta[key] === undefined || refreshDelta[key] === null || refreshDelta[key] === "") {
    failures.push(`feed.refreshDelta is missing ${key}`);
  }
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(refreshDelta.currentRefreshDate ?? "")) {
  failures.push("feed.refreshDelta.currentRefreshDate must be YYYY-MM-DD");
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(refreshDelta.previousRefreshDate ?? "")) {
  failures.push("feed.refreshDelta.previousRefreshDate must be YYYY-MM-DD");
}

if (!Array.isArray(refreshDelta.rowIds)) {
  failures.push("feed.refreshDelta.rowIds must be an array");
}

if (previousFeed.lastUpdated && refreshDelta.previousRefreshDate !== previousFeed.lastUpdated) {
  failures.push("feed.refreshDelta.previousRefreshDate must match previousFeed.lastUpdated");
}

const ids = new Set();
const previousRows = new Map((previousFeed.rows ?? []).map((row) => [row.id, row]));
const changedRows = [];
const reverifyFirstRows = [];
for (const [index, row] of (feed.rows ?? []).entries()) {
  const label = row.id || `row-${index}`;
  if (!row.id) failures.push(`${label} is missing id`);
  if (ids.has(row.id)) failures.push(`${label} has duplicate id`);
  ids.add(row.id);

  for (const key of [
    "project",
    "protocol",
    "chain",
    "liveEndpoint",
    "pricing",
    "proofStatus",
    "status",
    "note",
    "sourceUrl",
    "lastVerified",
    "lastChanged",
    "changeStatus",
    "changeNote",
  ]) {
    if (!row[key]) failures.push(`${label} is missing ${key}`);
  }

  if (row.sourceUrl && !/^https:\/\//.test(row.sourceUrl)) {
    failures.push(`${label} sourceUrl must be an https URL`);
  }

  if (row.proofStatus && !allowedProofStatuses.has(row.proofStatus)) {
    failures.push(`${label} has unknown proofStatus ${row.proofStatus}`);
  }

  if (row.lastChanged && !/^\d{4}-\d{2}-\d{2}$/.test(row.lastChanged)) {
    failures.push(`${label} lastChanged must be YYYY-MM-DD`);
  }

  if (typeof row.changedSincePreviousRefresh !== "boolean") {
    failures.push(`${label} changedSincePreviousRefresh must be boolean`);
  }

  if (row.changeStatus && !allowedChangeStatuses.has(row.changeStatus)) {
    failures.push(`${label} has unknown changeStatus ${row.changeStatus}`);
  }

  if (row.changeStatus === "reverify-first") {
    reverifyFirstRows.push(row.id);
  }

  const previousRow = previousRows.get(row.id);
  const mechanicallyChanged =
    !previousRow ||
    [
      "project",
      "protocol",
      "chain",
      "liveEndpoint",
      "pricing",
      "proofStatus",
      "status",
      "note",
      "sourceTitle",
      "sourceUrl",
    ].some((key) => normalize(row[key]) !== normalize(previousRow[key]));

  if (mechanicallyChanged) {
    changedRows.push(row.id);
  }

  if (row.changedSincePreviousRefresh !== mechanicallyChanged) {
    failures.push(`${label} changedSincePreviousRefresh must match previous feed comparison`);
  }

  if (mechanicallyChanged && row.changeStatus !== "changed") {
    failures.push(`${label} changeStatus must be changed when row differs from previous feed`);
  }

  if (!mechanicallyChanged && row.changeStatus === "changed") {
    failures.push(`${label} changeStatus cannot be changed when row matches previous feed`);
  }

  if (row.note && /\b(finalist|winner|prize awarded|guaranteed|endorsed)\b/i.test(row.note)) {
    failures.push(`${label} note contains an overclaim`);
  }
}

if (refreshDelta.changedRowCount !== changedRows.length) {
  failures.push(`feed.refreshDelta.changedRowCount must be ${changedRows.length}`);
}

if (refreshDelta.reverifyFirstRowCount !== reverifyFirstRows.length) {
  failures.push(`feed.refreshDelta.reverifyFirstRowCount must be ${reverifyFirstRows.length}`);
}

const expectedDeltaRowIds = new Set([...changedRows, ...reverifyFirstRows]);
for (const rowId of expectedDeltaRowIds) {
  if (!refreshDelta.rowIds?.includes(rowId)) {
    failures.push(`feed.refreshDelta.rowIds is missing expected delta row: ${rowId}`);
  }
}

for (const rowId of refreshDelta.rowIds ?? []) {
  if (!ids.has(rowId)) {
    failures.push(`feed.refreshDelta.rowIds references unknown row: ${rowId}`);
  } else if (!expectedDeltaRowIds.has(rowId)) {
    failures.push(`feed.refreshDelta.rowIds includes row without changed/reverify-first status: ${rowId}`);
  }
}

const returnBrief = feed.returnBrief ?? {};
if (returnBrief.title !== "Return Brief") {
  failures.push("feed.returnBrief.title must be Return Brief");
}

for (const key of ["checkFirst", "whyReturn", "nextSafeAction", "caveat"]) {
  if (!returnBrief[key]) {
    failures.push(`feed.returnBrief is missing ${key}`);
  }
}

if (!Array.isArray(returnBrief.rowIds) || returnBrief.rowIds.length < 3) {
  failures.push("feed.returnBrief.rowIds must reference at least 3 rows");
} else {
  for (const rowId of returnBrief.rowIds) {
    if (!ids.has(rowId)) {
      failures.push(`feed.returnBrief.rowIds references unknown row: ${rowId}`);
    }
  }
}

for (const token of [
  "Agent Payment Signal Ledger",
  "feed.json",
  "proof-status",
  "Last updated",
  "Do not treat ecosystem listings as payment proof",
  "Return Brief",
  "Check first",
  "Why return",
  "Next safe action",
  "Delta since last refresh",
  "id=\"return-brief-delta\"",
  "id=\"return-brief-delta-rows\"",
  "Watch rows",
  "id=\"return-brief\"",
  "id=\"return-brief-rows\"",
  "renderReturnBrief",
]) {
  if (!pageHtml.includes(token)) {
    failures.push(`${pagePath} is missing ${token}`);
  }
}

for (const row of feed.rows ?? []) {
  if (row.proofStatus && !pageHtml.includes(row.proofStatus)) {
    failures.push(`${pagePath} is missing proof-status label ${row.proofStatus}`);
  }
}

if (!homeHtml.includes("/agent-payments/signal-ledger/")) {
  failures.push("index.html must link the ledger from the portfolio surface");
}

const project = projects.find((item) => item.name === "Agent Payment Signal Ledger");
if (!project) {
  failures.push("projects.json is missing Agent Payment Signal Ledger");
} else {
  if (project.url !== "/agent-payments/signal-ledger/") {
    failures.push(`Agent Payment Signal Ledger project URL is ${project.url}`);
  }
  for (const token of ["x402", "L402", "agent payments"]) {
    const haystack = `${project.description} ${project.tags.join(" ")}`;
    if (!haystack.includes(token)) {
      failures.push(`Agent Payment Signal Ledger project is missing token: ${token}`);
    }
  }
}

if (!sitemapXml.includes(ledgerUrl)) {
  failures.push("sitemap.xml is missing the ledger URL");
}

for (const [label, content] of [
  [pagePath, pageHtml],
  [feedPath, feedJson],
  [previousFeedPath, previousFeedJson],
  [snapshotScriptPath, snapshotScript],
  ["index.html", homeHtml],
  ["projects.json", projectsJson],
]) {
  for (const banned of ["C:\\\\Users\\\\andre", "private key", "seed phrase"]) {
    if (content.includes(banned)) {
      failures.push(`${label} contains banned token: ${banned}`);
    }
  }
}

const output = {
  ok: failures.length === 0,
  failures,
  checked: {
    pagePath,
    feedPath,
    rows: feed.rows?.length ?? 0,
    lastUpdated: feed.lastUpdated ?? null,
  },
};

console.log(JSON.stringify(output, null, 2));
process.exit(output.ok ? 0 : 1);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

async function readOptional(path) {
  try {
    return await read(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      failures.push(`${path} is missing`);
      return "";
    }
    throw error;
  }
}

function parseJson(content, path) {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch (error) {
    failures.push(`${path} is not valid JSON: ${error.message}`);
    return null;
  }
}

function normalize(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}
