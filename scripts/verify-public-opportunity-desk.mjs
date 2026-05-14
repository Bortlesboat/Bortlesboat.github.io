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
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
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
    const workbookLink = document.querySelector('a[href$="Grant-Admin-Support-Sample-Workbook-2026-05-14.xlsx"]');
    const workbookHref = workbookLink?.getAttribute("href") ?? "";
    const sampleRows = document.querySelectorAll("#sample tbody tr").length;
    const heroReport = document.querySelector(".hero-report")?.getBoundingClientRect();

    return {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
      hasHeroVisual: Boolean(heroReport && heroReport.width > 250 && heroReport.height > 250),
      hasSample: Boolean(document.querySelector("#sample")),
      hasPipeline: Boolean(document.querySelector("#pipeline")),
      hasValidation: Boolean(document.querySelector("#validation")),
      hasMonitor: Boolean(document.querySelector("#monitor")),
      hasScenarios: Boolean(document.querySelector("#scenarios")),
      hasPricing: Boolean(document.querySelector("#pricing")),
      hasStart: Boolean(document.querySelector("#start")),
      sampleRows,
      hasWorkbookSample: text.includes("Grant-admin support workbook sample") &&
        text.includes("Download workbook") &&
        workbookHref.includes("Grant-Admin-Support-Sample-Workbook-2026-05-14.xlsx"),
      workbookHref,
      pipelineCards: document.querySelectorAll("#pipeline .pipeline-card").length,
      hasPipelineSummary: text.includes("13") &&
        text.includes("tracked rows") &&
        text.includes("live or near-live") &&
        text.includes("scope benchmarks") &&
        text.includes("$0") &&
        text.includes("proof status"),
      hasPipelineSupportOnly: text.includes("The grant-admin lane is repeatable, but still support-only.") &&
        text.includes("reimbursement trackers") &&
        text.includes("source-document checklists") &&
        text.includes("2 CFR Part 200 evidence map") &&
        text.includes("No prime grant-administrator bid") &&
        text.includes("one qualified no-charge review"),
      validationCards: document.querySelectorAll("#validation .pipeline-card").length,
      validationRows: document.querySelectorAll("#validation tbody tr").length,
      hasValidationDefinition: text.includes("What counts as working now") &&
        text.includes("official public sources") &&
        text.includes("qualified reviewer") &&
        text.includes("revenue target") &&
        text.includes("Income proof still requires a paid, funded, or settled event"),
      hasCurrentPublicSourceScorecard: text.includes("Florida Small Cities CDBG cycle") &&
        text.includes("May 20, 2026") &&
        text.includes("May 5 vs May 20 source conflict") &&
        text.includes("City of Temple, Georgia") &&
        text.includes("due May 30, 2026") &&
        text.includes("Macclenny CDBG-DR") &&
        text.includes("Find the official city packet first"),
      monitorCards: document.querySelectorAll("#monitor .pipeline-card").length,
      monitorRows: document.querySelectorAll("#monitor tbody tr").length,
      hasGeneratedMonitor: text.includes("Generated monitor, not another hand-built list") &&
        text.includes("source entries") &&
        text.includes("ranked rows") &&
        text.includes("registry sources") &&
        text.includes("direct-bid rows"),
      hasMonitorOps: text.includes("source registry and scoring config") &&
        text.includes("refresh runbook") &&
        text.includes("5 source artifacts") &&
        text.includes("9 registry rows") &&
        text.includes("8 scoring weights") &&
        text.includes("5 refresh steps"),
      hasReviewerBrief: text.includes("JEA/JAA government-consulting and grant-support reviewer brief") &&
        text.includes("saves time, catches a blocker") &&
        text.includes("bid/partner/watch/skip") &&
        text.includes("Approve one qualified grant-admin validation ask"),
      hasMonitorTopRows: text.includes("JAA federal government relations") &&
        text.includes("JAA state and local government consulting") &&
        text.includes("JEA Grant Consulting Services RFQ 106132") &&
        text.includes("FloridaCommerce CPTA 2026-2027"),
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
        sourceLinks.includes("JAA State/Local Consulting") &&
        sourceLinks.includes("JAA Federal Relations") &&
        sourceLinks.includes("JAXPORT") &&
        sourceLinks.includes("JEA Formal") &&
        sourceLinks.includes("JEA Informal") &&
        sourceLinks.includes("JEA Professional Forecast") &&
        sourceLinks.includes("St. Johns County") &&
        sourceLinks.includes("JSEB") &&
        sourceLinks.includes("UNF APEX") &&
        sourceLinks.includes("Avon Park CDBG-DR") &&
        sourceLinks.includes("FloridaCommerce CDBG") &&
        sourceLinks.includes("FloridaCommerce Small Cities Program") &&
        sourceLinks.includes("Rebuild Florida IRP") &&
        sourceLinks.includes("Florida CDBG-DR/RIF Awards") &&
        sourceLinks.includes("Columbia County CDBG") &&
        sourceLinks.includes("Georgia DCA CDBG-DR") &&
        sourceLinks.includes("Temple GA Grants") &&
        sourceLinks.includes("Monroe GA Scope PDF") &&
        sourceLinks.includes("Florida CPTA") &&
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
  if (!report.hasPipeline) failures.push(`${name}: missing #pipeline section`);
  if (!report.hasValidation) failures.push(`${name}: missing #validation section`);
  if (!report.hasMonitor) failures.push(`${name}: missing #monitor section`);
  if (!report.hasScenarios) failures.push(`${name}: missing #scenarios section`);
  if (!report.hasPricing) failures.push(`${name}: missing #pricing section`);
  if (!report.hasStart) failures.push(`${name}: missing #start section`);
  if (report.sampleRows !== 5) failures.push(`${name}: expected 5 sample opportunity rows, saw ${report.sampleRows}`);
  if (!report.hasWorkbookSample) failures.push(`${name}: missing workbook sample download`);
  if (report.pipelineCards !== 4) failures.push(`${name}: expected 4 pipeline cards, saw ${report.pipelineCards}`);
  if (!report.hasPipelineSummary) failures.push(`${name}: missing grant-admin pipeline summary`);
  if (!report.hasPipelineSupportOnly) failures.push(`${name}: missing support-only grant-admin pipeline boundaries`);
  if (report.validationCards !== 4) failures.push(`${name}: expected 4 validation cards, saw ${report.validationCards}`);
  if (report.validationRows !== 4) failures.push(`${name}: expected 4 validation scorecard rows, saw ${report.validationRows}`);
  if (!report.hasValidationDefinition) failures.push(`${name}: missing no-charge validation definition`);
  if (!report.hasCurrentPublicSourceScorecard) failures.push(`${name}: missing current public-source scorecard copy`);
  if (report.monitorCards !== 4) failures.push(`${name}: expected 4 monitor cards, saw ${report.monitorCards}`);
  if (report.monitorRows !== 5) failures.push(`${name}: expected 5 generated monitor rows, saw ${report.monitorRows}`);
  if (!report.hasGeneratedMonitor) failures.push(`${name}: missing generated monitor summary`);
  if (!report.hasMonitorOps) failures.push(`${name}: missing monitor ops/config copy`);
  if (!report.hasReviewerBrief) failures.push(`${name}: missing reviewer brief gate copy`);
  if (!report.hasMonitorTopRows) failures.push(`${name}: missing generated monitor top rows`);
  if (report.scenarioCards !== 6) failures.push(`${name}: expected 6 scenario cards, saw ${report.scenarioCards}`);
  if (!report.hasScenarioSpecifics) failures.push(`${name}: missing scenario-specific copy`);
  if (!report.hasNoChargeValidation) failures.push(`${name}: missing no-charge validation copy`);
  if (!report.hasVerification) failures.push(`${name}: missing verification copy`);
  if (!report.hasNoPasswords) failures.push(`${name}: missing password boundary`);
  if (!report.hasNoAwardPromises) failures.push(`${name}: missing award-promise boundary`);
  if (!report.hasNoSubmission) failures.push(`${name}: missing bid-submission boundary`);
  if (!report.hasOfficialSources) failures.push(`${name}: missing expected official source links`);
  if (report.sourceLinkCount < 27) failures.push(`${name}: expected at least 27 source links, saw ${report.sourceLinkCount}`);
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

const workbookPath = path.join(publicRoot, "public-opportunity-desk", "Grant-Admin-Support-Sample-Workbook-2026-05-14.xlsx");
if (!fs.existsSync(workbookPath) || fs.statSync(workbookPath).size < 5000) {
  failures.push("workbook sample asset missing or unexpectedly small");
}

const output = { ok: failures.length === 0, failures, desktop, mobile };
console.log(JSON.stringify(output, null, 2));
process.exit(output.ok ? 0 : 1);
