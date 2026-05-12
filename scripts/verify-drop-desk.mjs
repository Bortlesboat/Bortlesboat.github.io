import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, stat, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const publicRoot = path.resolve("public");
const providedUrl = process.argv[2];
const outDir = fileURLToPath(new URL("../output/playwright/", import.meta.url));
await mkdir(outDir, { recursive: true });
const repoBrowserCache = path.resolve(".playwright-browsers");
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(repoBrowserCache)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = repoBrowserCache;
}
const { chromium } = await import("playwright");

const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
]);

let server;
let url = providedUrl;
if (!url) {
  server = createServer(async (req, res) => {
    try {
      const rawPath = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname);
      const safePath = path.normalize(rawPath).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]/, "");
      let filePath = path.join(publicRoot, safePath);
      const info = await stat(filePath).catch(() => null);
      if (info?.isDirectory()) filePath = path.join(filePath, "index.html");
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": mime.get(path.extname(filePath)) || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}/devday/drop-desk/`;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
const consoleIssues = [];

page.on("console", (msg) => {
  if (["error", "warning"].includes(msg.type())) consoleIssues.push(`${msg.type()}: ${msg.text()}`);
});
page.on("pageerror", (err) => consoleIssues.push(`pageerror: ${err.message}`));

function readState() {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function clickCanvas(logicalX, logicalY) {
  const box = await page.locator("#game").boundingBox();
  if (!box) throw new Error("Canvas bounding box unavailable");
  await page.mouse.click(box.x + (logicalX / 1280) * box.width, box.y + (logicalY / 720) * box.height);
}

async function pickThreeAndLock() {
  await clickCanvas(146, 235);
  await clickCanvas(320, 235);
  await clickCanvas(146, 321);
  await page.keyboard.press("Space");
  await page.waitForTimeout(100);
  return readState();
}

try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  await page.screenshot({ path: path.join(outDir, "drop-desk-title.png"), fullPage: true });

  const title = await readState();
  if (title.mode !== "title") throw new Error(`Expected title mode, got ${title.mode}`);

  await page.locator("#startBtn").click();
  await page.waitForTimeout(100);
  const started = await readState();
  if (started.mode !== "playing") throw new Error(`Expected playing mode, got ${started.mode}`);
  if (started.visibleItems.length !== 8) throw new Error(`Expected 8 items, got ${started.visibleItems.length}`);
  if (started.maxDays !== 3) throw new Error(`Expected a simple 3-drop run, got ${started.maxDays}`);
  if (started.target > 500) throw new Error(`Expected friendly target at or below $500, got ${started.target}`);
  if (!started.simpleRules?.goal || !started.simpleRules.goal.includes("Pick 3")) {
    throw new Error(`Expected simple rules goal, got ${JSON.stringify(started.simpleRules)}`);
  }
  if (!started.scoutBrief?.title || !Array.isArray(started.scoutBrief?.featuredLabels)) {
    throw new Error(`Expected v2 scout brief, got ${JSON.stringify(started.scoutBrief)}`);
  }
  if (typeof started.momentum !== "number" || typeof started.streak !== "number") {
    throw new Error(`Expected v2 momentum and streak, got ${JSON.stringify({ momentum: started.momentum, streak: started.streak })}`);
  }
  if (!started.visibleItems.every((item) => item.trait && typeof item.risk === "number")) {
    throw new Error("Expected every item to expose trait and risk");
  }

  await clickCanvas(138, 224);
  await clickCanvas(312, 224);
  await page.evaluate(() => window.advanceTime(5000));
  await page.screenshot({ path: path.join(outDir, "drop-desk-gameplay.png"), fullPage: true });
  const picked = await readState();
  if (picked.picks.length !== 2) throw new Error(`Expected 2 picks, got ${picked.picks.length}`);
  if (!(picked.timeLeft < started.timeLeft)) throw new Error("Expected time to advance");

  await page.keyboard.press("Space");
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(outDir, "drop-desk-locked.png"), fullPage: true });
  const locked = await readState();
  if (locked.history.length !== 1) throw new Error(`Expected 1 history row, got ${locked.history.length}`);
  if (locked.day !== 2) throw new Error(`Expected day 2 after locking, got ${locked.day}`);
  if (!locked.history[0].combo || !locked.history[0].event || !locked.history[0].breakdown) {
    throw new Error(`Expected v2 history combo/event/breakdown, got ${JSON.stringify(locked.history[0])}`);
  }
  if (!locked.lastResult?.gradeHint) {
    throw new Error(`Expected v2 lastResult grade hint, got ${JSON.stringify(locked.lastResult)}`);
  }

  while ((await readState()).mode === "playing") {
    await pickThreeAndLock();
  }
  const finished = await readState();
  if (!["won", "lost"].includes(finished.mode)) throw new Error(`Expected finished mode, got ${finished.mode}`);
  if (finished.mode !== "won") throw new Error(`Expected basic verifier route to be winnable, got ${finished.mode}`);
  if (!finished.finalRank || !finished.finalRank.label || typeof finished.finalRank.score !== "number") {
    throw new Error(`Expected v2 final rank, got ${JSON.stringify(finished.finalRank)}`);
  }
  await page.screenshot({ path: path.join(outDir, "drop-desk-finished.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  const mobileBox = await page.locator("#game").boundingBox();
  if (!mobileBox || mobileBox.width < 320 || mobileBox.height < 180) {
    throw new Error(`Mobile canvas too small: ${JSON.stringify(mobileBox)}`);
  }
  await page.screenshot({ path: path.join(outDir, "drop-desk-mobile.png"), fullPage: true });

  if (consoleIssues.length) throw new Error(`Console issues:\n${consoleIssues.join("\n")}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        url,
        picked: picked.picks.length,
        history: locked.history.length,
        day: locked.day,
        finalMode: finished.mode,
        finalRank: finished.finalRank,
        screenshots: [
          "output/playwright/drop-desk-title.png",
          "output/playwright/drop-desk-gameplay.png",
          "output/playwright/drop-desk-locked.png",
          "output/playwright/drop-desk-finished.png",
          "output/playwright/drop-desk-mobile.png",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
