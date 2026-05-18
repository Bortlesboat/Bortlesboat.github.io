import { readFile } from "node:fs/promises";

import {
  analyzeCsvText,
  analyzeVariance,
  analyzeWorkbook,
  buildBoardMemo,
  normalizeFinancialRecords,
  rowsToObjects,
} from "../public/variance-memo/src/variance.js";

const root = new URL("../", import.meta.url);

const files = {
  html: await read("public/variance-memo/index.html"),
  app: await read("public/variance-memo/src/app.js"),
  styles: await read("public/variance-memo/src/styles.css"),
  variance: await read("public/variance-memo/src/variance.js"),
  projects: await read("src/data/projects.json"),
  sitemap: await read("public/sitemap.xml"),
};

const requiredTokens = [
  ["html", "Finance File Triage"],
  ["html", "Private finance workbench"],
  ["html", "Local browser processing"],
  ["html", "No upload"],
  ["html", "CSV or XLSX"],
  ["html", "Analyst Draft"],
  ["html", "importAudit"],
  ["html", "previewRows"],
  ["html", "chooseFileButton"],
  ["html", "Load demo sample"],
  ["html", "Download Markdown"],
  ["html", "confidenceCheck"],
  ["html", "unmappedCheck"],
  ["html", "refusalCheck"],
  ["html", "app.js?v=financial-triage-v01-20260518"],
  ["html", "analysisHead"],
  ["app", "synthetic-saas-pl.csv"],
  ["app", "analyzeFile"],
  ["app", "renderImportAudit"],
  ["app", "renderDiagnosticSummary"],
  ["app", "confidenceLabel"],
  ["app", "unmappedColumns"],
  ["app", "refusedInferences"],
  ["app", "finance-file-triage"],
  ["app", "renderPortfolioRows"],
  ["app", "renderTransactionRows"],
  ["app", "renderInvoiceRows"],
  ["app", "Portfolio positions"],
  ["app", "Financial transactions"],
  ["app", "Invoice aging"],
  ["app", "Unsupported file"],
  ["app", "chooseFileButton.addEventListener(\"click\""],
  ["app", "sourceMode = \"upload\""],
  ["app", "sourceMode = \"demo\""],
  ["app", "variance.js?v=financial-triage-v01-20260518"],
  ["variance", "What the file supports"],
  ["variance", "needs context"],
  ["variance", "Portfolio Snapshot"],
  ["variance", "portfolio_positions"],
  ["variance", "Cash Activity Snapshot"],
  ["variance", "financial_transactions"],
  ["variance", "Invoice Aging Snapshot"],
  ["variance", "invoice_aging"],
  ["variance", "Unsupported File Structure"],
  ["variance", "unsupported_financial_file"],
  ["variance", "parseWorkbook"],
  ["variance", "analyzeWorkbook"],
  ["variance", "inspectRows"],
  ["variance", "normalizeFinancialRecords"],
  ["variance", "forecast_risk"],
  ["projects", "Finance File Triage"],
  ["projects", "/variance-memo/"],
  ["sitemap", "https://bortlesboat.github.io/variance-memo/"],
];

for (const [file, token] of requiredTokens) {
  if (!files[file].includes(token)) {
    throw new Error(`${file} is missing required token: ${token}`);
  }
}

if (/searchParams[\s\S]*sample/.test(files.app)) {
  throw new Error("App still auto-loads the synthetic sample from URL params");
}

const bannedTokens = ["EasyPost", "NetSuite", "OneDrive - Trane", "C:\\\\Users\\\\andre"];
for (const [file, content] of Object.entries(files)) {
  for (const token of bannedTokens) {
    if (content.includes(token)) {
      throw new Error(`${file} contains banned private token: ${token}`);
    }
  }
}

const sampleCsv = `Account,Department,Category,Period,Actual,Budget,Forecast
SaaS recurring revenue,Sales,Revenue,Jan 2026,120000,100000,245000
Cloud hosting,Engineering,COGS,Jan 2026,42500,35000,80000`;

const result = analyzeCsvText(sampleCsv, {
  dollarThreshold: 5000,
  percentThreshold: 0.1,
});

if (result.normalizedRows.length !== 2) {
  throw new Error(`Expected 2 normalized rows, found ${result.normalizedRows.length}`);
}

if (result.analysis.variances.length !== 2) {
  throw new Error(`Expected 2 material variances, found ${result.analysis.variances.length}`);
}

if (!result.memo.markdown.includes("## Analyst Draft") || !result.memo.markdown.includes("[row 2]")) {
  throw new Error("Generated memo is missing analyst draft or source row references");
}

const preambleRows = [
  ["Monthly Board Package"],
  ["Generated", "2026-02-05"],
  ["Account", "Department", "Category", "Period", "Actual", "Budget", "Forecast"],
  ["Implementation revenue", "Services", "Revenue", "Feb 2026", "$84,000", "$70,000", "$150,000"],
];
const preambleResult = analyzeVariance(normalizeFinancialRecords(rowsToObjects(preambleRows)), {
  dollarThreshold: 5000,
  percentThreshold: 0.1,
});
const preambleMemo = buildBoardMemo(preambleResult);
if (!preambleMemo.markdown.includes("Implementation revenue") || preambleMemo.markdown.includes("Monthly Board Package")) {
  throw new Error("Header preamble handling is not anchored to the uploaded file rows");
}

const noAnchorResult = analyzeVariance(
  normalizeFinancialRecords([
    {
      "Jan 2026 Actual": "$120,000",
      "Jan 2026 Budget": "$100,000",
    },
  ]),
  { dollarThreshold: 5000, percentThreshold: 0.1 },
);
const noAnchorMemo = buildBoardMemo(noAnchorResult);
if (noAnchorResult.variances.length !== 0 || noAnchorMemo.markdown.includes("Unspecified account")) {
  throw new Error("Verifier caught invented commentary without an account anchor");
}

const workbookResult = analyzeWorkbook(
  {
    sheets: [
      {
        name: "Cover",
        rows: [["Board package"], ["Prepared for leadership"]],
      },
      {
        name: "P&L Export",
        rows: [
          ["Monthly Board Package"],
          ["Account", "Department", "Category", "Period", "Actual", "Budget", "Forecast"],
          ["Implementation revenue", "Services", "Revenue", "Feb 2026", "84000", "70000", "150000"],
        ],
      },
    ],
  },
  { dollarThreshold: 5000, percentThreshold: 0.1 },
);
if (workbookResult.importReport.sourceSheet !== "P&L Export" || !workbookResult.memo.markdown.includes("Implementation revenue")) {
  throw new Error("Workbook sheet selection did not choose the mappable uploaded sheet");
}

const messyResult = analyzeWorkbook(
  {
    sheets: [
      {
        name: "Variance Export",
        rows: [
          ["Acme SaaS monthly review"],
          ["", "Team", "Type", "Actual Jan 2026", "Budget Jan 2026", "Forecast Jan 2026"],
          ["Recurring subscription revenue", "Sales", "Revenue", "420000", "390000", "810000"],
          ["Customer onboarding contractors", "Success", "Expense", "66000", "45000", "120000"],
        ],
      },
    ],
  },
  { dollarThreshold: 10000, percentThreshold: 0.08 },
);
if (
  messyResult.importReport.mappedFields.account !== "Column 1" ||
  !messyResult.memo.markdown.includes("What the file supports") ||
  !messyResult.memo.markdown.includes("needs context")
) {
  throw new Error("Messy semi-structured finance export did not produce a useful caveated analyst draft");
}

const portfolioCsv = `Account Number,Account Name,Symbol,Description,Quantity,Last Price,Last Price Change,Current Value,Today's Gain/Loss Dollar,Today's Gain/Loss Percent,Total Gain/Loss Dollar,Total Gain/Loss Percent,Percent Of Account,Cost Basis Total,Average Cost Basis,Type
111111111,Taxable Brokerage,ABC,Example Equity Fund,10,$100.00,$1.00,$1000.00,$10.00,1.00%,$125.00,14.29%,50.00%,$875.00,$87.50,Stock
111111111,Taxable Brokerage,XYZ,Example Bond Fund,20,$25.00,-$0.10,$500.00,-$2.00,-0.40%,-$25.00,-4.76%,25.00%,$525.00,$26.25,Bond
222222222,Retirement Account,CASH**,Held in money market,,,$0.00,$250.00,,,,$0.00,100.00%,,,Cash
"The data and information in this spreadsheet is provided for informational purposes only."`;
const portfolioResult = analyzeCsvText(portfolioCsv, { dollarThreshold: 5000, percentThreshold: 0.1 });
if (
  portfolioResult.importReport.mode !== "portfolio_positions" ||
  portfolioResult.normalizedRows.length !== 3 ||
  portfolioResult.analysis.kind !== "portfolio" ||
  portfolioResult.analysis.summary.totalValue !== 1750 ||
  !portfolioResult.memo.markdown.includes("Portfolio Snapshot") ||
  !portfolioResult.memo.markdown.includes("Needs context before acting") ||
  portfolioResult.memo.markdown.includes("actual-vs-budget")
) {
  throw new Error("Portfolio positions export did not produce a useful holdings summary");
}

const transactionCsv = `Date,Account,Description,Category,Debit,Credit,Balance
2026-04-01,Checking,Payroll deposit,Income,,$5000.00,$5000.00
2026-04-02,Checking,Rent payment,Housing,$1800.00,,$3200.00
2026-04-03,Credit Card,Grocery store,Groceries,$125.50,,$3074.50
2026-04-04,Credit Card,Software subscription,Software,$49.00,,$3025.50
2026-04-05,Savings,Transfer to savings,Transfer,$500.00,,$2525.50`;
const transactionResult = analyzeCsvText(transactionCsv, { dollarThreshold: 5000, percentThreshold: 0.1 });
if (
  transactionResult.importReport.mode !== "financial_transactions" ||
  transactionResult.normalizedRows.length !== 5 ||
  transactionResult.analysis.kind !== "transactions" ||
  transactionResult.analysis.summary.totalInflows !== 5000 ||
  transactionResult.analysis.summary.totalOutflows !== 2474.5 ||
  !transactionResult.memo.markdown.includes("Cash Activity Snapshot") ||
  !transactionResult.memo.markdown.includes("Needs context before acting") ||
  transactionResult.memo.markdown.includes("actual-vs-budget")
) {
  throw new Error("Transaction export did not produce a useful cash activity summary");
}

const invoiceCsv = `Vendor,Invoice Number,Invoice Date,Due Date,Open Amount,Days Past Due,Aging Bucket,Status
Cloud Vendor,INV-1001,2026-03-01,2026-03-31,$1200.00,18,1-30,Open
Contractor LLC,INV-1002,2026-02-15,2026-03-15,$3400.00,34,31-60,Open
Software Co,INV-1003,2026-04-10,2026-05-10,$800.00,0,Current,Open
Office Supplier,INV-1004,2026-01-15,2026-02-15,$600.00,63,61-90,Disputed`;
const invoiceResult = analyzeCsvText(invoiceCsv, { dollarThreshold: 5000, percentThreshold: 0.1 });
if (
  invoiceResult.importReport.mode !== "invoice_aging" ||
  invoiceResult.normalizedRows.length !== 4 ||
  invoiceResult.analysis.kind !== "invoices" ||
  invoiceResult.analysis.summary.openAmount !== 6000 ||
  invoiceResult.analysis.summary.overdueAmount !== 5200 ||
  !invoiceResult.memo.markdown.includes("Invoice Aging Snapshot") ||
  !invoiceResult.memo.markdown.includes("Needs context before acting") ||
  invoiceResult.memo.markdown.includes("actual-vs-budget")
) {
  throw new Error("Invoice aging export did not produce a useful invoice summary");
}

const unsupportedCsv = `Statement Section,Line Label,Value,Notes
Summary,Opening balance,$1000.00,Statement-only rollforward
Summary,Closing balance,$1250.00,No transaction-level detail
Disclosure,Important note,N/A,Informational text`;
const unsupportedResult = analyzeCsvText(unsupportedCsv, { dollarThreshold: 5000, percentThreshold: 0.1 });
if (
  unsupportedResult.importReport.mode !== "unsupported_financial_file" ||
  unsupportedResult.importReport.canAnalyze ||
  unsupportedResult.analysis.kind !== "unsupported" ||
  !unsupportedResult.memo.markdown.includes("Unsupported File Structure") ||
  !unsupportedResult.memo.markdown.includes("Supported modes") ||
  unsupportedResult.memo.markdown.includes("actual-vs-budget variances were detected")
) {
  throw new Error("Unsupported financial file did not produce a clear unsupported-mode message");
}

console.log("finance-file-triage verifier ok: public files, sitemap, project card, deterministic analysis, and privacy guardrails passed");

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}
