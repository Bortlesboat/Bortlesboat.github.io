import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const feedPath = "public/agent-payments/signal-ledger/feed.json";
const previousFeedPath = "public/agent-payments/signal-ledger/feed.previous.json";
const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log([
    "Snapshot the Agent Payment Signal Ledger feed before a manual refresh.",
    "",
    "Usage:",
    "  node scripts/snapshot-agent-payment-ledger-feed.mjs",
    "  node scripts/snapshot-agent-payment-ledger-feed.mjs --write",
    "",
    "Default mode is a dry run. Use --write to copy feed.json to feed.previous.json.",
  ].join("\n"));
  process.exit(0);
}

for (const arg of args) {
  if (arg !== "--write") {
    throw new Error(`Unknown argument: ${arg}`);
  }
}

const currentFeedText = await readFile(new URL(feedPath, root), "utf8");
const currentFeed = JSON.parse(currentFeedText);
const writeSnapshot = args.has("--write");

if (currentFeed.title !== "Agent Payment Signal Ledger") {
  throw new Error("feed.json is not the Agent Payment Signal Ledger feed");
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(currentFeed.lastUpdated ?? "")) {
  throw new Error("feed.json lastUpdated must be YYYY-MM-DD before snapshot");
}

if (!Array.isArray(currentFeed.rows) || currentFeed.rows.length === 0) {
  throw new Error("feed.json must contain rows before snapshot");
}

if (writeSnapshot) {
  await writeFile(new URL(previousFeedPath, root), currentFeedText);
}

console.log(JSON.stringify({
  ok: true,
  action: "snapshot-agent-payment-ledger-feed",
  mode: writeSnapshot ? "write" : "dry-run",
  source: feedPath,
  target: previousFeedPath,
  rows: currentFeed.rows.length,
  lastUpdated: currentFeed.lastUpdated,
  wrote: writeSnapshot,
  nextAction: writeSnapshot
    ? "Edit feed.json with the new manual source refresh, then run the ledger verifier."
    : "Review this snapshot summary, then rerun with --write before editing feed.json.",
}, null, 2));
