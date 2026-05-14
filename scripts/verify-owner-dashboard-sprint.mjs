import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(repoRoot, ".playwright-browsers");
const { chromium } = await import("playwright");

const publicRoot = path.join(repoRoot, "public");
const screenshotDir = path.join(repoRoot, "output", "playwright");
fs.mkdirSync(screenshotDir, { recursive: true });

const chromiumPath = path.join(repoRoot, ".playwright-browsers", "chromium-1223", "chrome-win64", "chrome.exe");
const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".json", "application/json; charset=utf-8"],
]);

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }

  let relativePath = decodeURIComponent(url.pathname);
  if (relativePath.endsWith("/")) relativePath += "index.html";
  const filePath = path.resolve(publicRoot, `.${relativePath}`);

  if (!filePath.startsWith(publicRoot)) {
    response.writeHead(403);
    response.end("forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404);
    response.end("missing");
    return;
  }
  response.writeHead(200, { "content-type": types.get(path.extname(filePath)) ?? "application/octet-stream" });
  fs.createReadStream(filePath).pipe(response);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

const browser = await chromium.launch({
  executablePath: fs.existsSync(chromiumPath) ? chromiumPath : undefined,
  headless: true,
});

const failures = [];

async function inspectViewport(name, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`http://127.0.0.1:${port}/owner-dashboard-sprint/#sample`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("#sample .scenario-card", { timeout: 5000 });
  await page.waitForTimeout(250);

  const report = await page.evaluate(() => {
    const headings = [...document.querySelectorAll("#sample .scenario-card h3")].map((el) => el.textContent.trim());
    const badImages = [...document.images]
      .filter((img) => !img.complete || img.naturalWidth < 100 || img.naturalHeight < 100)
      .map((img) => img.alt || img.src);
    const sampleRect = document.querySelector("#sample")?.getBoundingClientRect();

    return {
      title: document.title,
      sampleExists: Boolean(document.querySelector("#sample")),
      scenarioCount: document.querySelectorAll("#sample .scenario-card").length,
      headings,
      hasSyntheticNote: document.body.textContent.includes("Figures above are synthetic examples"),
      hasOwnerScenario: document.body.textContent.includes("Owner cash sprint"),
      hasBuyerScenario: document.body.textContent.includes("SBA buyer model"),
      hasCpaScenario: document.body.textContent.includes("CPA referral packet"),
      hasLenderScenario: document.body.textContent.includes("Lender-ready view"),
      badImages,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      sampleTop: sampleRect?.top ?? null,
    };
  });

  await page.screenshot({
    path: path.join(screenshotDir, `owner-dashboard-sprint-scenarios-${name}.png`),
    fullPage: true,
  });
  await page.close();

  if (report.title !== "Owner Dashboard Sprint | Andrew Barnes") failures.push(`${name}: unexpected title ${report.title}`);
  if (!report.sampleExists) failures.push(`${name}: missing #sample section`);
  if (report.scenarioCount !== 4) failures.push(`${name}: expected 4 scenario cards, saw ${report.scenarioCount}`);
  if (!report.hasSyntheticNote) failures.push(`${name}: missing synthetic-data note`);
  if (!report.hasOwnerScenario) failures.push(`${name}: missing owner cash scenario`);
  if (!report.hasBuyerScenario) failures.push(`${name}: missing SBA buyer scenario`);
  if (!report.hasCpaScenario) failures.push(`${name}: missing CPA referral scenario`);
  if (!report.hasLenderScenario) failures.push(`${name}: missing lender-ready scenario`);
  if (report.badImages.length) failures.push(`${name}: bad images ${report.badImages.join(", ")}`);
  if (report.horizontalOverflow > 1) failures.push(`${name}: horizontal overflow ${report.horizontalOverflow}px`);
  if (Math.abs(report.sampleTop) > viewport.height) failures.push(`${name}: #sample anchor did not land near the scenario section`);
  if (errors.length) failures.push(`${name}: console/page errors ${errors.join(" | ")}`);

  return report;
}

const desktop = await inspectViewport("desktop", { width: 1440, height: 1300 });
const mobile = await inspectViewport("mobile", { width: 390, height: 1200 });

await browser.close();
server.close();

const output = { ok: failures.length === 0, failures, desktop, mobile };
console.log(JSON.stringify(output, null, 2));
process.exit(output.ok ? 0 : 1);
