import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const failures = [];

const files = {
  home: await read("index.html"),
  ledger: await read("public/agent-payments/signal-ledger/index.html"),
  analytics: await read("public/analytics.js"),
  trackingPlan: await read("public/analytics/tracking-plan.json"),
  rootLlms: await read("public/llms.txt"),
  ledgerLlms: await read("public/agent-payments/signal-ledger/llms.txt"),
  robots: await read("public/robots.txt"),
  sitemap: await read("public/sitemap.xml"),
  docs: await read("docs/analytics-and-discoverability.md"),
};

const trackingPlan = parseJson(files.trackingPlan, "tracking-plan.json");

for (const [label, content] of Object.entries(files)) {
  for (const banned of ["C:/Users/andre", "C:\\Users\\andre", "private key", "seed phrase", "sk_live", "sk_test"]) {
    if (content.includes(banned)) {
      failures.push(`${label} contains banned token: ${banned}`);
    }
  }
}

for (const [label, content] of [
  ["home", files.home],
  ["ledger", files.ledger],
]) {
  requireToken(label, content, "/analytics.js");
}

for (const token of [
  "window.bbAnalytics",
  "page_viewed",
  "ledger_feed_opened",
  "ledger_source_clicked",
  "proof_link_clicked",
  "outbound_link_clicked",
  "window.dataLayer",
  "window.gtag",
  "window.plausible",
  "window.posthog",
  "window.umami",
  "bb:analytics",
  "utm_campaign",
]) {
  requireToken("analytics.js", files.analytics, token);
}

for (const token of [
  "GPTBot",
  "ChatGPT-User",
  "PerplexityBot",
  "ClaudeBot",
  "anthropic-ai",
  "Google-Extended",
  "Bingbot",
  "Sitemap: https://bortlesboat.github.io/sitemap.xml",
]) {
  requireToken("robots.txt", files.robots, token);
}

for (const token of [
  "https://bortlesboat.github.io/agent-payments/signal-ledger/",
  "https://bortlesboat.github.io/proof/",
  "https://bortlesboat.github.io/llms.txt",
]) {
  requireToken("sitemap.xml", files.sitemap, token);
}

for (const token of [
  "Agent Payment Signal Ledger",
  "feed.json",
  "x402 paid API endpoints",
  "Do not infer partnerships",
]) {
  requireToken("ledger llms.txt", files.ledgerLlms, token);
}

for (const token of [
  "Proof graph",
  "Agent Payment Signal Ledger feed",
  "x402 and L402 agent payments",
  "Claim Boundaries",
]) {
  requireToken("root llms.txt", files.rootLlms, token);
}

for (const token of [
  '"@type": "Dataset"',
  '"@type": "FAQPage"',
  '"@type": "BreadcrumbList"',
  '"@type": "ItemList"',
  "x402 paid API endpoints",
  "data-analytics-event=\"ledger_feed_opened\"",
  "data-analytics-event=\"ledger_source_clicked\"",
  "data-source-id",
]) {
  requireToken("ledger page", files.ledger, token);
}

if (trackingPlan) {
  const eventNames = new Set((trackingPlan.events ?? []).map((event) => event.name));
  for (const eventName of [
    "page_viewed",
    "ledger_feed_opened",
    "ledger_source_clicked",
    "proof_link_clicked",
    "outbound_link_clicked",
  ]) {
    if (!eventNames.has(eventName)) {
      failures.push(`tracking plan is missing event: ${eventName}`);
    }
  }
}

for (const token of [
  "Cloudflare Web Analytics",
  "Google Search Console",
  "sitemap.xml",
  "bb_debug_analytics",
]) {
  requireToken("analytics docs", files.docs, token);
}

const output = {
  ok: failures.length === 0,
  failures,
  checked: {
    analyticsBytes: files.analytics.length,
    trackingEvents: trackingPlan?.events?.length ?? 0,
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

function parseJson(content, label) {
  try {
    return JSON.parse(content);
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
