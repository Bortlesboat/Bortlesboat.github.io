import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const failures = [];

const proofUrl = "https://bortlesboat.github.io/proof/";
const graphUrl = "https://bortlesboat.github.io/proof/graph.json";
const ledgerUrl = "https://bortlesboat.github.io/agent-payments/signal-ledger/";
const canonicalFeedUrl = "https://bortlesboat.github.io/agent-payments/signal-ledger/feed.json";
const llmsUrl = "https://bortlesboat.github.io/llms.txt";

const files = {
  page: await read("public/proof/index.html"),
  graph: await read("public/proof/graph.json"),
  feed: await read("public/agent-payments/signal-ledger/feed.json"),
  compatibilityFeed: await read("public/proof/agent-payments-signal-ledger/feed.json"),
  ledgerPage: await read("public/agent-payments/signal-ledger/index.html"),
  sitemap: await read("public/sitemap.xml"),
  robots: await read("public/robots.txt"),
  llms: await read("public/llms.txt"),
  homepage: await read("index.html"),
};

const graph = parseJson(files.graph, "graph.json");
const feed = parseJson(files.feed, "agent-payments/signal-ledger/feed.json");
const compatibilityFeed = parseJson(files.compatibilityFeed, "proof/agent-payments-signal-ledger/feed.json");

requireToken("page", files.page, "Bortlesboat Proof Graph");
requireToken("page", files.page, "proofGraphData");
requireToken("page", files.page, "graph.json");
requireToken("page", files.page, "/agent-payments/signal-ledger/feed.json");
requireToken("page", files.page, "application/ld+json");
requireToken("page", files.page, 'rel="alternate"');
requireToken("page", files.page, graphUrl);
requireToken("page", files.page, canonicalFeedUrl);
requireToken("page", files.page, llmsUrl);
requireToken("ledgerPage", files.ledgerPage, "application/ld+json");
requireToken("ledgerPage", files.ledgerPage, "llms.txt");
requireToken("homepage", files.homepage, "/proof/");

for (const [label, content] of [
  ["page", files.page],
  ["ledgerPage", files.ledgerPage],
]) {
  parseJsonLdBlocks(content, label);
}

for (const token of [proofUrl, graphUrl, ledgerUrl, canonicalFeedUrl, llmsUrl]) {
  requireToken("sitemap", files.sitemap, token);
}

for (const token of ["GPTBot", "ChatGPT-User", "PerplexityBot", "ClaudeBot", "anthropic-ai", "Google-Extended", "Sitemap: https://bortlesboat.github.io/sitemap.xml"]) {
  requireToken("robots", files.robots, token);
}

for (const token of [proofUrl, graphUrl, ledgerUrl, canonicalFeedUrl, "Citation notes", "Topical tags"]) {
  requireToken("llms", files.llms, token);
}

if (graph) {
  if (graph.schemaVersion !== "proof-graph-v0") {
    failures.push(`Unexpected graph schemaVersion: ${graph.schemaVersion}`);
  }

  if (graph.canonicalUrl !== proofUrl) {
    failures.push(`graph canonicalUrl must be ${proofUrl}`);
  }

  if (graph.discovery?.graphUrl !== graphUrl) {
    failures.push(`graph.discovery.graphUrl must be ${graphUrl}`);
  }

  if (graph.discovery?.canonicalSignalLedgerUrl !== ledgerUrl) {
    failures.push(`graph.discovery.canonicalSignalLedgerUrl must be ${ledgerUrl}`);
  }

  if (graph.discovery?.canonicalSignalFeedUrl !== canonicalFeedUrl) {
    failures.push(`graph.discovery.canonicalSignalFeedUrl must be ${canonicalFeedUrl}`);
  }

  if (graph.discovery?.llmsUrl !== llmsUrl) {
    failures.push(`graph.discovery.llmsUrl must be ${llmsUrl}`);
  }

  if (!Array.isArray(graph.nodes) || graph.nodes.length < 4 || graph.nodes.length > 6) {
    failures.push(`graph must expose 4-6 nodes, found ${graph?.nodes?.length ?? "none"}`);
  }

  const requiredNodeIds = [
    "agent-payment-signal-ledger",
    "agentops-ledger",
    "satoshi-satlab",
    "finance-file-triage",
    "fpa-advisory",
    "oss-contributions",
  ];
  const ids = new Set(graph.nodes?.map((node) => node.id));
  for (const id of requiredNodeIds) {
    if (!ids.has(id)) {
      failures.push(`graph is missing required node: ${id}`);
    }
  }

  const advertisedUrls = new Set(Object.values(graph.discovery ?? {}).filter((value) => typeof value === "string"));

  for (const node of graph.nodes ?? []) {
    for (const field of ["id", "name", "status", "summary", "lastVerified"]) {
      if (!node[field]) {
        failures.push(`${node.id ?? "unknown node"} is missing ${field}`);
      }
    }
    if (!Array.isArray(node.proofLinks) || node.proofLinks.length < 2) {
      failures.push(`${node.id} needs at least two proofLinks`);
    }
    if (!Array.isArray(node.openBlockers) || node.openBlockers.length === 0) {
      failures.push(`${node.id} needs openBlockers`);
    }
    if (!Array.isArray(node.publicBoundary) || node.publicBoundary.length === 0) {
      failures.push(`${node.id} needs publicBoundary`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(node.lastVerified ?? "")) {
      failures.push(`${node.id} lastVerified must be YYYY-MM-DD`);
    }
    for (const link of [...(node.proofLinks ?? []), ...(node.machineLinks ?? []), ...(node.screenshots ?? [])]) {
      if (!link.label || !link.url) {
        failures.push(`${node.id} has a link missing label or url`);
      }
      if (link.url.includes("C:/") || link.url.includes("C:\\") || link.url.includes("Users/andre")) {
        failures.push(`${node.id} exposes a local path: ${link.url}`);
      }
      advertisedUrls.add(link.url);
    }
  }

  if (!advertisedUrls.has(canonicalFeedUrl)) {
    failures.push(`graph must advertise canonical signal feed URL: ${canonicalFeedUrl}`);
  }

  for (const url of advertisedUrls) {
    if (typeof url === "string" && url.includes("/proof/agent-payments-signal-ledger/feed.json")) {
      failures.push("graph must not advertise the proof-local compatibility feed");
    }
  }
}

if (feed) {
  if (feed.title !== "Agent Payment Signal Ledger") {
    failures.push("canonical feed title must be Agent Payment Signal Ledger");
  }
  if (feed.url !== ledgerUrl) {
    failures.push(`canonical feed url must be ${ledgerUrl}`);
  }
  if (feed.feedUrl !== canonicalFeedUrl) {
    failures.push(`canonical feed feedUrl must be ${canonicalFeedUrl}`);
  }
  if (!feed.schemaVersion) {
    failures.push("canonical feed must expose schemaVersion");
  }
  if (!Array.isArray(feed.rows) || feed.rows.length < 10) {
    failures.push(`canonical feed must expose at least 10 rows, found ${feed?.rows?.length ?? "none"}`);
  }
  for (const row of feed.rows ?? []) {
    for (const field of ["id", "project", "protocol", "status", "proofStatus", "sourceUrl", "lastVerified"]) {
      if (!row[field]) {
        failures.push(`canonical feed row ${row.id ?? row.project ?? "unknown"} is missing ${field}`);
      }
    }
    if (!/^https:\/\//.test(row.sourceUrl ?? "")) {
      failures.push(`canonical feed row ${row.project} sourceUrl must be absolute public HTTPS URL`);
    }
    for (const value of [row.sourceUrl, row.liveEndpoint]) {
      if (String(value ?? "").includes("C:/") || String(value ?? "").includes("Users/andre")) {
        failures.push(`canonical feed row ${row.project} exposes a local path`);
      }
    }
  }
}

if (compatibilityFeed) {
  if (compatibilityFeed.schemaVersion !== "agent-payment-signal-ledger-v0") {
    failures.push(`Unexpected compatibility feed schemaVersion: ${compatibilityFeed.schemaVersion}`);
  }
  if (compatibilityFeed.canonicalFeedUrl !== canonicalFeedUrl) {
    failures.push(`compatibility feed must point to ${canonicalFeedUrl}`);
  }
  if (compatibilityFeed.compatibilitySnapshot !== true) {
    failures.push("compatibility feed must mark compatibilitySnapshot true");
  }
}

for (const [label, content] of Object.entries(files)) {
  for (const banned of [
    "C:/Users/andre",
    "C:\\Users\\andre",
    "private key",
    "secret",
    "winner",
    "prize awarded",
    "guaranteed yield",
    "revenue share",
  ]) {
    if (content.toLowerCase().includes(banned.toLowerCase())) {
      failures.push(`${label} contains banned token: ${banned}`);
    }
  }
}

const output = {
  ok: failures.length === 0,
  failures,
  checked: {
    graphNodes: graph?.nodes?.length ?? 0,
    signalRows: feed?.rows?.length ?? 0,
    canonicalFeedUrl,
    llms: true,
  },
};

console.log(JSON.stringify(output, null, 2));
process.exit(output.ok ? 0 : 1);

async function read(path) {
  try {
    return await readFile(new URL(path, root), "utf8");
  } catch (error) {
    failures.push(`Missing required file: ${path}`);
    return "";
  }
}

function parseJson(text, label) {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    failures.push(`${label} is not valid JSON: ${error.message}`);
    return null;
  }
}

function parseJsonLdBlocks(html, label) {
  const blocks = [...html.matchAll(/<script\s+type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/gi)];
  if (blocks.length === 0) {
    failures.push(`${label} must include JSON-LD`);
  }
  for (const [index, block] of blocks.entries()) {
    try {
      JSON.parse(block[1]);
    } catch (error) {
      failures.push(`${label} JSON-LD block ${index + 1} is invalid: ${error.message}`);
    }
  }
}

function requireToken(label, content, token) {
  if (!content.includes(token)) {
    failures.push(`${label} is missing token: ${token}`);
  }
}
