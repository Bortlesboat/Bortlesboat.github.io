import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const graph = JSON.parse(await read("public/proof/graph.json"));
const feed = JSON.parse(await read("public/agent-payments/signal-ledger/feed.json"));

const urls = new Set();

for (const value of Object.values(graph.discovery ?? {})) {
  if (isPublicUrl(value)) {
    urls.add(value);
  }
}

for (const node of graph.nodes) {
  for (const group of ["proofLinks", "machineLinks", "screenshots"]) {
    for (const link of node[group] ?? []) {
      if (isPublicUrl(link.url)) {
        urls.add(link.url);
      }
    }
  }
}

for (const row of feed.rows) {
  for (const url of [row.sourceUrl, row.liveEndpoint]) {
    if (isPublicUrl(url)) {
      urls.add(url);
    }
  }
}

const failures = [];
const checked = [];

for (const url of [...urls].sort()) {
  const result = await check(url);
  checked.push(result);
  if (!result.ok) {
    failures.push(`${url} returned ${result.status ?? "no status"} ${result.error ?? ""}`.trim());
  }
}

const output = {
  ok: failures.length === 0,
  failures,
  checkedCount: checked.length,
  checked,
};

console.log(JSON.stringify(output, null, 2));
process.exit(output.ok ? 0 : 1);

async function check(url) {
  const localPath = localSitePath(url);
  if (localPath) {
    try {
      await read(localPath);
      return {
        url,
        status: "local",
        ok: true,
      };
    } catch (error) {
      return {
        url,
        status: "local-missing",
        ok: false,
        error: error.message,
      };
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    let response = await fetchUrl(url, "HEAD", controller.signal);
    if (response.status === 405) {
      response = await fetchUrl(url, "GET", controller.signal);
    }
    return {
      url,
      status: response.status,
      ok: isLiveStatus(response.status),
    };
  } catch (error) {
    return {
      url,
      status: null,
      ok: false,
      error: error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function fetchUrl(url, method, signal) {
  return fetch(url, {
    method,
    redirect: "follow",
    signal,
  });
}

function isLiveStatus(status) {
  return (status >= 200 && status < 400) || status === 402;
}

function isPublicUrl(url) {
  return /^https?:\/\//.test(url ?? "");
}

function localSitePath(url) {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== "https://bortlesboat.github.io") {
      return null;
    }
    const pathname = parsed.pathname === "/" ? "/index.html" : parsed.pathname;
    const localPaths = {
      "/index.html": "index.html",
      "/proof/": "public/proof/index.html",
      "/proof/graph.json": "public/proof/graph.json",
      "/agent-payments/signal-ledger/": "public/agent-payments/signal-ledger/index.html",
      "/agent-payments/signal-ledger/feed.json": "public/agent-payments/signal-ledger/feed.json",
      "/agent-payments/signal-ledger/feed.previous.json": "public/agent-payments/signal-ledger/feed.previous.json",
      "/llms.txt": "public/llms.txt",
      "/sitemap.xml": "public/sitemap.xml",
      "/robots.txt": "public/robots.txt",
    };
    return localPaths[pathname] ?? null;
  } catch {
    return null;
  }
}

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}
