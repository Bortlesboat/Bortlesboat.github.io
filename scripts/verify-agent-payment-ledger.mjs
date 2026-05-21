import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const failures = [];

const pagePath = "public/agent-payments/signal-ledger/index.html";
const feedPath = "public/agent-payments/signal-ledger/feed.json";

const [pageHtml, feedJson, homeHtml, projectsJson, sitemapXml] = await Promise.all([
  readOptional(pagePath),
  readOptional(feedPath),
  read("index.html"),
  read("src/data/projects.json"),
  read("public/sitemap.xml"),
]);

const feed = parseJson(feedJson, feedPath) ?? {};
const projects = JSON.parse(projectsJson);

const ledgerUrl = "https://bortlesboat.github.io/agent-payments/signal-ledger/";
const feedUrl = `${ledgerUrl}feed.json`;
const allowedProofStatuses = new Set([
  "live-discovery",
  "paid-call-captured",
  "public-proof-packet",
  "ecosystem-listed",
  "public-observatory",
  "protocol-doc",
  "platform-doc",
]);

if (feed.title !== "Agent Payment Signal Ledger") {
  failures.push("feed.title must be Agent Payment Signal Ledger");
}

if (feed.url !== ledgerUrl) {
  failures.push(`feed.url must be ${ledgerUrl}`);
}

if (feed.feedUrl !== feedUrl) {
  failures.push(`feed.feedUrl must be ${feedUrl}`);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(feed.lastUpdated ?? "")) {
  failures.push("feed.lastUpdated must be YYYY-MM-DD");
}

if (!Array.isArray(feed.rows) || feed.rows.length < 10) {
  failures.push("feed.rows must contain at least 10 rows");
}

const ids = new Set();
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
  ]) {
    if (!row[key]) failures.push(`${label} is missing ${key}`);
  }

  if (row.sourceUrl && !/^https:\/\//.test(row.sourceUrl)) {
    failures.push(`${label} sourceUrl must be an https URL`);
  }

  if (row.proofStatus && !allowedProofStatuses.has(row.proofStatus)) {
    failures.push(`${label} has unknown proofStatus ${row.proofStatus}`);
  }

  if (row.note && /\b(finalist|winner|prize awarded|guaranteed|endorsed)\b/i.test(row.note)) {
    failures.push(`${label} note contains an overclaim`);
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
