import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const failures = [];

const files = {
  page: await read("public/proof/index.html"),
  graph: await read("public/proof/graph.json"),
  feed: await read("public/proof/agent-payments-signal-ledger/feed.json"),
  sitemap: await read("public/sitemap.xml"),
  homepage: await read("index.html"),
};

const graph = parseJson(files.graph, "graph.json");
const feed = parseJson(files.feed, "agent-payments-signal-ledger/feed.json");

requireToken("page", files.page, "Bortlesboat Proof Graph");
requireToken("page", files.page, "proofGraphData");
requireToken("page", files.page, "graph.json");
requireToken("page", files.page, "agent-payments-signal-ledger/feed.json");
requireToken("homepage", files.homepage, "/proof/");
requireToken("sitemap", files.sitemap, "https://bortlesboat.github.io/proof/");

if (graph) {
  if (graph.schemaVersion !== "proof-graph-v0") {
    failures.push(`Unexpected graph schemaVersion: ${graph.schemaVersion}`);
  }

  if (graph.canonicalUrl !== "https://bortlesboat.github.io/proof/") {
    failures.push("graph canonicalUrl must be https://bortlesboat.github.io/proof/");
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
    }
  }
}

if (feed) {
  if (feed.schemaVersion !== "agent-payment-signal-ledger-v0") {
    failures.push(`Unexpected feed schemaVersion: ${feed.schemaVersion}`);
  }
  if (!Array.isArray(feed.rows) || feed.rows.length < 10) {
    failures.push(`feed must expose at least 10 rows, found ${feed?.rows?.length ?? "none"}`);
  }
  for (const row of feed.rows ?? []) {
    for (const field of ["project", "protocol", "status", "proofStatus", "sourceUrl", "lastChecked"]) {
      if (!row[field]) {
        failures.push(`feed row ${row.project ?? "unknown"} is missing ${field}`);
      }
    }
    if (!/^https?:\/\//.test(row.sourceUrl ?? "")) {
      failures.push(`feed row ${row.project} sourceUrl must be absolute public URL`);
    }
    if (row.sourceUrl?.includes("C:/") || row.sourceUrl?.includes("Users/andre")) {
      failures.push(`feed row ${row.project} exposes a local path`);
    }
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

function requireToken(label, content, token) {
  if (!content.includes(token)) {
    failures.push(`${label} is missing token: ${token}`);
  }
}
