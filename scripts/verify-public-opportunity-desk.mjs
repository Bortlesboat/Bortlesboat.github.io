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
  await page.waitForSelector("#fit-grader [data-grader-score]", { timeout: 5000 });
  await page.waitForSelector("#feedback-signal [data-feedback-mailto]", { timeout: 5000 });
  await page.waitForTimeout(250);

  const report = await page.evaluate(() => {
    const text = document.body.textContent;
    const requestLink = document.querySelector('a[href^="mailto:"][href*="public%20opportunity%20validation%20request"]')?.getAttribute("href") ?? "";
    const sourceLinks = [...document.querySelectorAll(".source-links a")].map((link) => link.textContent.trim());
    const workbookLink = document.querySelector('a[href$="Grant-Admin-Support-Sample-Workbook-2026-05-14.xlsx"]');
    const workbookHref = workbookLink?.getAttribute("href") ?? "";
    const rhtpWorkbookLink = document.querySelector('a[href$="AHCA-RHTP-Readiness-Matrix-2026-05-14.xlsx"]');
    const rhtpWorkbookHref = rhtpWorkbookLink?.getAttribute("href") ?? "";
    const jhfaWorkbookLink = document.querySelector('a[href$="JHFA-DIA-Affordable-Housing-Finance-Readiness-2026-05-14.xlsx"]');
    const jhfaWorkbookHref = jhfaWorkbookLink?.getAttribute("href") ?? "";
    const surplusWorkbookLink = document.querySelector('a[href$="Surplus-Tax-Deed-Paper-Trade-Rejection-Workbook-2026-05-14.xlsx"]');
    const surplusWorkbookHref = surplusWorkbookLink?.getAttribute("href") ?? "";
    const sampleRows = document.querySelectorAll("#sample tbody tr").length;
    const heroReport = document.querySelector(".hero-report")?.getBoundingClientRect();

    return {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
      hasHeroVisual: Boolean(heroReport && heroReport.width > 250 && heroReport.height > 250),
      hasSample: Boolean(document.querySelector("#sample")),
      hasPipeline: Boolean(document.querySelector("#pipeline")),
      hasValidation: Boolean(document.querySelector("#validation")),
      hasRhtpReadiness: Boolean(document.querySelector("#rhtp-readiness")),
      hasMonitor: Boolean(document.querySelector("#monitor")),
      hasFdotReadiness: Boolean(document.querySelector("#fdot-readiness")),
      hasScenarios: Boolean(document.querySelector("#scenarios")),
      hasFitGrader: Boolean(document.querySelector("#fit-grader")),
      hasFeedbackSignal: Boolean(document.querySelector("#feedback-signal")),
      hasPricing: Boolean(document.querySelector("#pricing")),
      hasStart: Boolean(document.querySelector("#start")),
      sampleRows,
      scenarioSampleCards: document.querySelectorAll("#sample [data-scenario-sample]").length,
      hasScenarioSampleCards: text.includes("Grant-admin support packet") &&
        text.includes("DEP Resilient Florida evidence checklist") &&
        text.includes("Contractor readiness screen") &&
        text.includes("AHCA RHTP health-readiness matrix") &&
        text.includes("Surplus and tax-deed paper trade") &&
        text.includes("support-only") &&
        text.includes("restricted comms") &&
        text.includes("no cash") &&
        text.includes("proof $0"),
      hasScenarioSampleDecisionModel: text.includes("Support or subcontract lane, not Andy as prime grant administrator") &&
        text.includes("Support/watch until an eligible applicant or advisor can judge the evidence gap") &&
        text.includes("Bid, partner, watch, or skip based on existing capability") &&
        text.includes("No-contact readiness matrix only while the restricted communication period applies") &&
        text.includes("Paper trade only until official sources produce repeatable, source-complete passes"),
      hasScenarioSampleVerification: text.includes("Qualified reviewer must say it saves time, catches a blocker") &&
        text.includes("Every row needs a source, eligible-applicant check, evidence module, blocker") &&
        text.includes("name at least one concrete blocker a contractor can confirm without sharing credentials") &&
        text.includes("qualified health/grants reviewer can judge the public-source matrix") &&
        text.includes("title, lien, access, zoning, utility, deposit, payment-deadline, and resale-cost screens"),
      hasScenarioSampleKillRules: text.includes("Stop if it requires compliance certification, portal submission, official reporting, or payment during validation") &&
        text.includes("No office-hours registration, DEP contact, application drafting, portal action, invoice, or payment request") &&
        text.includes("Stop if fleet, license, bonding, crew, package access, or site access would need to be created from scratch") &&
        text.includes("No AHCA contact, applicant contact, RFA questions, portal registration, bid, invoice, or payment request") &&
        text.includes("No auction registration, deposit, bid, purchase, owner contact, agency contact, or cash movement"),
      workbookCards: document.querySelectorAll("#workbooks .workbook-card").length,
      hasWorkbookSample: text.includes("Grant-admin support workbook sample") &&
        text.includes("Download workbook") &&
        workbookHref.includes("Grant-Admin-Support-Sample-Workbook-2026-05-14.xlsx"),
      hasWorkbookRepeatabilityCopy: text.includes("source-change tracker") &&
        text.includes("approval-dependency tracker") &&
        text.includes("closeout tracker"),
      hasScenarioWorkbookLibrary: text.includes("Scenario workbook library") &&
        text.includes("Grant-admin support sample") &&
        text.includes("RHTP health-readiness matrix") &&
        text.includes("Affordable-housing finance readiness") &&
        text.includes("Surplus/tax-deed rejection workbook") &&
        text.includes("proof $0") &&
        text.includes("Download grant workbook") &&
        text.includes("Download RHTP workbook") &&
        text.includes("Download housing workbook") &&
        text.includes("Download rejection workbook") &&
        jhfaWorkbookHref.includes("JHFA-DIA-Affordable-Housing-Finance-Readiness-2026-05-14.xlsx") &&
        surplusWorkbookHref.includes("Surplus-Tax-Deed-Paper-Trade-Rejection-Workbook-2026-05-14.xlsx"),
      workbookHref,
      jhfaWorkbookHref,
      surplusWorkbookHref,
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
      rhtpCards: document.querySelectorAll("#rhtp-readiness .pipeline-card").length,
      rhtpRows: document.querySelectorAll("#rhtp-readiness tbody tr").length,
      hasRhtpReadinessSummary: text.includes("Fresh state-program test: AHCA RHTP readiness") &&
        text.includes("4") &&
        text.includes("official AHCA sources") &&
        text.includes("10") &&
        text.includes("readiness modules") &&
        text.includes("8") &&
        text.includes("matrix rows") &&
        text.includes("$0") &&
        text.includes("proof status"),
      hasRhtpWorkbook: text.includes("Download RHTP workbook") &&
        text.includes("Summary, Readiness Matrix, Module Checks, Sources, Proof Classifier, and Checks sheets") &&
        text.includes("0 formula errors") &&
        text.includes("6 rendered sheet previews") &&
        rhtpWorkbookHref.includes("AHCA-RHTP-Readiness-Matrix-2026-05-14.xlsx"),
      hasRhtpMatrixRows: text.includes("Eligibility and bundle fit") &&
        text.includes("Financial solvency and controls") &&
        text.includes("Data collection and reporting plan") &&
        text.includes("Vendor procurement and contract management") &&
        text.includes("official RFA documents") &&
        text.includes("partner approval") &&
        text.includes("contract ownership"),
      hasRhtpBoundary: text.includes("restricted communication period") &&
        text.includes("does not authorize AHCA") &&
        text.includes("applicant contact") &&
        text.includes("RFA questions") &&
        text.includes("portal registration") &&
        text.includes("payment requests") &&
        text.includes("Approve one qualified grant-admin validation ask"),
      rhtpWorkbookHref,
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
      fdotCards: document.querySelectorAll("#fdot-readiness .pipeline-card").length,
      fdotRows: document.querySelectorAll("#fdot-readiness tbody tr").length,
      hasFdotReadinessSummary: text.includes("Second lane: FDOT contractor readiness") &&
        text.includes("Northeast Florida expansion scan") &&
        text.includes("official rows") &&
        text.includes("FDOT rows") &&
        text.includes("not income proof") &&
        text.includes("no FDOT-specific send gate exists yet"),
      hasFdotPacketRows: text.includes("FDOT E21R4-R0 stormwater systems") &&
        text.includes("FDOT E21R6-R0 St. Johns concrete repair") &&
        text.includes("FDOT E22A4-R0 districtwide sod BDI") &&
        text.includes("Clay Utility ITB 25/26-A03 residuals hauling"),
      hasFdotReadinessChecks: text.includes("official package status") &&
        text.includes("portal submission readiness") &&
        text.includes("license/work-class/BDI fit") &&
        text.includes("insurance, bonding, MOT") &&
        text.includes("5 readiness checks"),
      hasFdotGate: text.includes("No FDOT-specific send gate exists yet") &&
        text.includes("does not authorize contractor contact") &&
        text.includes("Approve one qualified grant-admin validation ask"),
      scenarioCards: document.querySelectorAll("#scenarios .scenario").length,
      hasScenarioSpecifics: text.includes("Six no-charge scenario lanes") &&
        text.includes("Grant-admin support") &&
        text.includes("Contractor readiness") &&
        text.includes("JSEB partner map") &&
        text.includes("Vendor portal gap") &&
        text.includes("Upstream award watch") &&
        text.includes("Referrer packet") &&
        text.includes("Source proof:") &&
        text.includes("Free output:") &&
        text.includes("Kill rule:") &&
        text.includes("proof-status separation"),
      fitGraderOptions: document.querySelectorAll("#fit-grader [data-grader-lane] option").length,
      fitGraderChecks: document.querySelectorAll("#fit-grader [data-grader-check]").length,
      fitGraderDefaultScore: document.querySelector("[data-grader-score]")?.textContent.trim() ?? "",
      feedbackLaneOptions: document.querySelectorAll("#feedback-signal [data-feedback-lane] option").length,
      feedbackVerdictOptions: document.querySelectorAll("#feedback-signal [data-feedback-verdict] option").length,
      feedbackDefaultHref: document.querySelector("#feedback-signal [data-feedback-mailto]")?.getAttribute("href") ?? "",
      hasFeedbackSignalCopy: text.includes("Send a structured usefulness signal") &&
        text.includes("Captured fields:") &&
        text.includes("scenario, verdict, blocker, source timestamp, proof status $0") &&
        text.includes("feedback capture, not a sales form") &&
        text.includes("A feedback note, page visit, workbook download, or meeting is validation evidence only") &&
        text.includes("Income proof still requires a paid, funded, settled, or claimable third-party event"),
      hasFitGraderCopy: text.includes("Self-serve fit grader") &&
        text.includes("pursue, partner, watch, or skip") &&
        text.includes("Current official source is named") &&
        text.includes("Existing capability matches the work") &&
        text.includes("Proof status: $0") &&
        text.includes("A grader result, page visit, workbook download, reply, or meeting is not income proof") &&
        text.includes("Approve one qualified grant-admin validation ask"),
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
        sourceLinks.includes("FDOT D2 Lettings") &&
        sourceLinks.includes("FDOT D2 Contracts") &&
        sourceLinks.includes("AHCA RHTP") &&
        sourceLinks.includes("AHCA RHTP Funding") &&
        sourceLinks.includes("AHCA RHTP Webinar") &&
        sourceLinks.includes("AHCA RHTP Deck") &&
        sourceLinks.includes("Clay Utility Procurement") &&
        sourceLinks.includes("Clay County OpenGov") &&
        sourceLinks.includes("Nassau Procurement") &&
        sourceLinks.includes("Flagler Procurement") &&
        sourceLinks.includes("Putnam Schools") &&
        sourceLinks.includes("Putnam Tax Deeds") &&
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

  await page.selectOption("[data-grader-lane]", "surplus");
  const checkCount = await page.locator("[data-grader-check]").count();
  for (let index = 0; index < checkCount; index += 1) {
    await page.locator("[data-grader-check]").nth(index).check();
  }
  const graderInteraction = await page.evaluate(() => ({
    score: document.querySelector("[data-grader-score]")?.textContent.trim() ?? "",
    call: document.querySelector("[data-grader-call]")?.textContent.trim() ?? "",
    summary: document.querySelector("[data-grader-summary]")?.textContent.trim() ?? "",
    output: document.querySelector("[data-grader-output]")?.textContent.trim() ?? ""
  }));
  report.graderInteraction = graderInteraction;

  await page.selectOption("[data-feedback-lane]", "contractor_readiness");
  await page.selectOption("[data-feedback-verdict]", "risky");
  await page.fill("[data-feedback-blocker]", "Bonding unclear");
  const feedbackInteraction = await page.evaluate(() => {
    const href = document.querySelector("[data-feedback-mailto]")?.getAttribute("href") ?? "";
    const decoded = decodeURIComponent(href);
    return {
      href,
      decoded
    };
  });
  report.feedbackInteraction = feedbackInteraction;

  await page.screenshot({
    path: path.join(screenshotDir, `public-opportunity-desk-${name}.png`),
    fullPage: false,
  });
  await page.locator("#workbooks").screenshot({
    path: path.join(screenshotDir, `public-opportunity-desk-workbooks-${name}.png`),
  });
  await page.close();

  if (report.title !== "North Florida Public Opportunity Desk | Andrew Barnes") failures.push(`${name}: unexpected title ${report.title}`);
  if (!report.description.includes("public opportunity validation")) failures.push(`${name}: missing useful meta description`);
  if (!report.hasHeroVisual) failures.push(`${name}: missing substantial hero report visual`);
  if (!report.hasSample) failures.push(`${name}: missing #sample section`);
  if (!report.hasPipeline) failures.push(`${name}: missing #pipeline section`);
  if (!report.hasValidation) failures.push(`${name}: missing #validation section`);
  if (!report.hasRhtpReadiness) failures.push(`${name}: missing #rhtp-readiness section`);
  if (!report.hasMonitor) failures.push(`${name}: missing #monitor section`);
  if (!report.hasFdotReadiness) failures.push(`${name}: missing #fdot-readiness section`);
  if (!report.hasScenarios) failures.push(`${name}: missing #scenarios section`);
  if (!report.hasFitGrader) failures.push(`${name}: missing #fit-grader section`);
  if (!report.hasFeedbackSignal) failures.push(`${name}: missing #feedback-signal section`);
  if (!report.hasPricing) failures.push(`${name}: missing #pricing section`);
  if (!report.hasStart) failures.push(`${name}: missing #start section`);
  if (report.sampleRows !== 5) failures.push(`${name}: expected 5 sample opportunity rows, saw ${report.sampleRows}`);
  if (report.scenarioSampleCards !== 5) failures.push(`${name}: expected 5 scenario sample cards, saw ${report.scenarioSampleCards}`);
  if (!report.hasScenarioSampleCards) failures.push(`${name}: missing scenario sample card labels or proof copy`);
  if (!report.hasScenarioSampleDecisionModel) failures.push(`${name}: missing scenario sample decision model copy`);
  if (!report.hasScenarioSampleVerification) failures.push(`${name}: missing scenario sample verification copy`);
  if (!report.hasScenarioSampleKillRules) failures.push(`${name}: missing scenario sample kill-rule boundaries`);
  if (!report.hasWorkbookSample) failures.push(`${name}: missing workbook sample download`);
  if (!report.hasWorkbookRepeatabilityCopy) failures.push(`${name}: missing workbook repeatability copy`);
  if (report.workbookCards !== 4) failures.push(`${name}: expected 4 scenario workbook cards, saw ${report.workbookCards}`);
  if (!report.hasScenarioWorkbookLibrary) failures.push(`${name}: missing scenario workbook library copy or links`);
  if (report.pipelineCards !== 4) failures.push(`${name}: expected 4 pipeline cards, saw ${report.pipelineCards}`);
  if (!report.hasPipelineSummary) failures.push(`${name}: missing grant-admin pipeline summary`);
  if (!report.hasPipelineSupportOnly) failures.push(`${name}: missing support-only grant-admin pipeline boundaries`);
  if (report.validationCards !== 4) failures.push(`${name}: expected 4 validation cards, saw ${report.validationCards}`);
  if (report.validationRows !== 4) failures.push(`${name}: expected 4 validation scorecard rows, saw ${report.validationRows}`);
  if (!report.hasValidationDefinition) failures.push(`${name}: missing no-charge validation definition`);
  if (!report.hasCurrentPublicSourceScorecard) failures.push(`${name}: missing current public-source scorecard copy`);
  if (report.rhtpCards !== 4) failures.push(`${name}: expected 4 RHTP cards, saw ${report.rhtpCards}`);
  if (report.rhtpRows !== 4) failures.push(`${name}: expected 4 RHTP matrix rows, saw ${report.rhtpRows}`);
  if (!report.hasRhtpReadinessSummary) failures.push(`${name}: missing RHTP readiness summary`);
  if (!report.hasRhtpWorkbook) failures.push(`${name}: missing RHTP workbook download and verification copy`);
  if (!report.hasRhtpMatrixRows) failures.push(`${name}: missing RHTP matrix row copy`);
  if (!report.hasRhtpBoundary) failures.push(`${name}: missing RHTP no-contact boundary`);
  if (report.monitorCards !== 4) failures.push(`${name}: expected 4 monitor cards, saw ${report.monitorCards}`);
  if (report.monitorRows !== 5) failures.push(`${name}: expected 5 generated monitor rows, saw ${report.monitorRows}`);
  if (!report.hasGeneratedMonitor) failures.push(`${name}: missing generated monitor summary`);
  if (!report.hasMonitorOps) failures.push(`${name}: missing monitor ops/config copy`);
  if (!report.hasReviewerBrief) failures.push(`${name}: missing reviewer brief gate copy`);
  if (!report.hasMonitorTopRows) failures.push(`${name}: missing generated monitor top rows`);
  if (report.fdotCards !== 4) failures.push(`${name}: expected 4 FDOT readiness cards, saw ${report.fdotCards}`);
  if (report.fdotRows !== 4) failures.push(`${name}: expected 4 FDOT readiness rows, saw ${report.fdotRows}`);
  if (!report.hasFdotReadinessSummary) failures.push(`${name}: missing FDOT readiness summary`);
  if (!report.hasFdotPacketRows) failures.push(`${name}: missing FDOT packet rows`);
  if (!report.hasFdotReadinessChecks) failures.push(`${name}: missing FDOT readiness checks`);
  if (!report.hasFdotGate) failures.push(`${name}: missing FDOT no-send gate copy`);
  if (report.scenarioCards !== 6) failures.push(`${name}: expected 6 scenario cards, saw ${report.scenarioCards}`);
  if (!report.hasScenarioSpecifics) failures.push(`${name}: missing scenario-specific copy`);
  if (report.fitGraderOptions !== 5) failures.push(`${name}: expected 5 fit-grader scenario options, saw ${report.fitGraderOptions}`);
  if (report.fitGraderChecks !== 8) failures.push(`${name}: expected 8 fit-grader checks, saw ${report.fitGraderChecks}`);
  if (report.fitGraderDefaultScore !== "2 / 8") failures.push(`${name}: expected default fit-grader score 2 / 8, saw ${report.fitGraderDefaultScore}`);
  if (report.feedbackLaneOptions !== 5) failures.push(`${name}: expected 5 feedback lane options, saw ${report.feedbackLaneOptions}`);
  if (report.feedbackVerdictOptions !== 3) failures.push(`${name}: expected 3 feedback verdict options, saw ${report.feedbackVerdictOptions}`);
  if (!report.feedbackDefaultHref.includes("public%20opportunity%20usefulness%20signal")) failures.push(`${name}: feedback default mailto missing usefulness signal subject`);
  if (!report.hasFeedbackSignalCopy) failures.push(`${name}: missing feedback signal copy or proof boundary`);
  if (!report.hasFitGraderCopy) failures.push(`${name}: missing fit-grader copy or proof boundary`);
  if (report.graderInteraction.score !== "5 / 8") failures.push(`${name}: expected surplus grader cap score 5 / 8, saw ${report.graderInteraction.score}`);
  if (report.graderInteraction.call !== "Paper trade only.") failures.push(`${name}: expected surplus paper-trade-only call, saw ${report.graderInteraction.call}`);
  if (!report.graderInteraction.output.includes("no-cash paper-trade rejection sheet")) failures.push(`${name}: surplus grader output missing no-cash paper-trade language`);
  if (!report.feedbackInteraction.decoded.includes("Scenario: contractor_readiness")) failures.push(`${name}: feedback mailto missing selected contractor lane`);
  if (!report.feedbackInteraction.decoded.includes("Verdict: risky")) failures.push(`${name}: feedback mailto missing selected risky verdict`);
  if (!report.feedbackInteraction.decoded.includes("Main blocker: Bonding unclear")) failures.push(`${name}: feedback mailto missing typed blocker`);
  if (!report.feedbackInteraction.decoded.includes("Proof status: $0")) failures.push(`${name}: feedback mailto missing proof status`);
  if (!report.feedbackInteraction.decoded.includes("not a payment request, bid, portal action, or income proof")) failures.push(`${name}: feedback mailto missing proof boundary`);
  if (!report.hasNoChargeValidation) failures.push(`${name}: missing no-charge validation copy`);
  if (!report.hasVerification) failures.push(`${name}: missing verification copy`);
  if (!report.hasNoPasswords) failures.push(`${name}: missing password boundary`);
  if (!report.hasNoAwardPromises) failures.push(`${name}: missing award-promise boundary`);
  if (!report.hasNoSubmission) failures.push(`${name}: missing bid-submission boundary`);
  if (!report.hasOfficialSources) failures.push(`${name}: missing expected official source links`);
  if (report.sourceLinkCount < 39) failures.push(`${name}: expected at least 39 source links, saw ${report.sourceLinkCount}`);
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

const rhtpWorkbookPath = path.join(publicRoot, "public-opportunity-desk", "AHCA-RHTP-Readiness-Matrix-2026-05-14.xlsx");
if (!fs.existsSync(rhtpWorkbookPath) || fs.statSync(rhtpWorkbookPath).size < 10000) {
  failures.push("RHTP workbook asset missing or unexpectedly small");
}

const jhfaWorkbookPath = path.join(publicRoot, "public-opportunity-desk", "JHFA-DIA-Affordable-Housing-Finance-Readiness-2026-05-14.xlsx");
if (!fs.existsSync(jhfaWorkbookPath) || fs.statSync(jhfaWorkbookPath).size < 10000) {
  failures.push("JHFA/DIA workbook asset missing or unexpectedly small");
}

const surplusWorkbookPath = path.join(publicRoot, "public-opportunity-desk", "Surplus-Tax-Deed-Paper-Trade-Rejection-Workbook-2026-05-14.xlsx");
if (!fs.existsSync(surplusWorkbookPath) || fs.statSync(surplusWorkbookPath).size < 10000) {
  failures.push("surplus/tax-deed workbook asset missing or unexpectedly small");
}

const output = { ok: failures.length === 0, failures, desktop, mobile };
console.log(JSON.stringify(output, null, 2));
process.exit(output.ok ? 0 : 1);
