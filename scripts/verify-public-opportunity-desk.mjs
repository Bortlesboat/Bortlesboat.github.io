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
  [".xml", "application/xml; charset=utf-8"],
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

  await page.goto(`http://127.0.0.1:${port}/public-opportunity-desk/`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("#sample .opportunity-table", { timeout: 5000 });
  await page.waitForTimeout(250);

  const report = await page.evaluate(() => {
    const text = document.body.textContent;
    const requestLink = document.querySelector('a[href^="mailto:"][href*="public%20opportunity%20validation%20request"]')?.getAttribute("href") ?? "";
    const sourceLinks = [...document.querySelectorAll(".source-links a")].map((link) => link.textContent.trim());
    const sampleRows = document.querySelectorAll("#sample tbody tr").length;
    const heroReport = document.querySelector(".hero-report")?.getBoundingClientRect();

    return {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
      hasHeroVisual: Boolean(heroReport && heroReport.width > 250 && heroReport.height > 250),
      hasSample: Boolean(document.querySelector("#sample")),
      hasScenarios: Boolean(document.querySelector("#scenarios")),
      hasPricing: Boolean(document.querySelector("#pricing")),
      hasStart: Boolean(document.querySelector("#start")),
      sampleRows,
      scenarioCards: document.querySelectorAll("#scenarios .scenario").length,
      hasScenarioSpecifics: text.includes("JSEB-ready") &&
        text.includes("Subcontractor-first") &&
        text.includes("Referrer packet") &&
        text.includes("Grant and capital screen"),
      hasNoChargeValidation: text.includes("No-charge validation first") &&
        text.includes("Live opportunity match") &&
        text.includes("Eligibility friction screen") &&
        text.includes("No invoice during validation"),
      hasVerification: text.includes("Verified first") &&
        text.includes("source links") &&
        text.includes("verification timestamp"),
      hasNoPasswords: text.includes("No passwords") || text.includes("No portal passwords"),
      hasNoAwardPromises: text.includes("No award promises"),
      hasNoSubmission: text.includes("No bid submission"),
      hasOfficialSources: sourceLinks.includes("COJ 1Cloud") &&
        sourceLinks.includes("JAA Bid Board") &&
        sourceLinks.includes("JAXPORT") &&
        sourceLinks.includes("JEA Formal") &&
        sourceLinks.includes("St. Johns County") &&
        sourceLinks.includes("JSEB") &&
        sourceLinks.includes("UNF APEX") &&
        sourceLinks.includes("DIA Facade") &&
        sourceLinks.includes("COJ Facade") &&
        sourceLinks.includes("Duval LBT"),
      sourceLinkCount: sourceLinks.length,
      requestLink,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

  await page.screenshot({
    path: path.join(screenshotDir, `public-opportunity-desk-${name}.png`),
    fullPage: true,
  });
  await page.close();

  if (report.title !== "North Florida Public Opportunity Desk | Andrew Barnes") failures.push(`${name}: unexpected title ${report.title}`);
  if (!report.description.includes("public opportunity validation")) failures.push(`${name}: missing useful meta description`);
  if (!report.hasHeroVisual) failures.push(`${name}: missing substantial hero report visual`);
  if (!report.hasSample) failures.push(`${name}: missing #sample section`);
  if (!report.hasScenarios) failures.push(`${name}: missing #scenarios section`);
  if (!report.hasPricing) failures.push(`${name}: missing #pricing section`);
  if (!report.hasStart) failures.push(`${name}: missing #start section`);
  if (report.sampleRows !== 5) failures.push(`${name}: expected 5 sample opportunity rows, saw ${report.sampleRows}`);
  if (report.scenarioCards !== 6) failures.push(`${name}: expected 6 scenario cards, saw ${report.scenarioCards}`);
  if (!report.hasScenarioSpecifics) failures.push(`${name}: missing scenario-specific copy`);
  if (!report.hasNoChargeValidation) failures.push(`${name}: missing no-charge validation copy`);
  if (!report.hasVerification) failures.push(`${name}: missing verification copy`);
  if (!report.hasNoPasswords) failures.push(`${name}: missing password boundary`);
  if (!report.hasNoAwardPromises) failures.push(`${name}: missing award-promise boundary`);
  if (!report.hasNoSubmission) failures.push(`${name}: missing bid-submission boundary`);
  if (!report.hasOfficialSources) failures.push(`${name}: missing expected official source links`);
  if (report.sourceLinkCount < 11) failures.push(`${name}: expected at least 11 source links, saw ${report.sourceLinkCount}`);
  if (!report.requestLink.includes("Trade%20or%20service")) failures.push(`${name}: request link missing prefilled intake body`);
  if (report.horizontalOverflow > 1) failures.push(`${name}: horizontal overflow ${report.horizontalOverflow}px`);
  if (errors.length) failures.push(`${name}: console/page errors ${errors.join(" | ")}`);

  return report;
}

const desktop = await inspectViewport("desktop", { width: 1440, height: 1300 });
const mobile = await inspectViewport("mobile", { width: 390, height: 1200 });

await browser.close();
server.close();

const sitemap = fs.readFileSync(path.join(publicRoot, "sitemap.xml"), "utf8");
if (!sitemap.includes("https://bortlesboat.github.io/public-opportunity-desk/")) {
  failures.push("sitemap missing public-opportunity-desk route");
}

const output = { ok: failures.length === 0, failures, desktop, mobile };
console.log(JSON.stringify(output, null, 2));
process.exit(output.ok ? 0 : 1);
