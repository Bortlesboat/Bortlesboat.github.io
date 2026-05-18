import { readFile } from "node:fs/promises";

import {
  analyzeCsvText,
  analyzeVariance,
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
  ["html", "Variance Memo"],
  ["html", "CSV or XLSX"],
  ["html", "Board Commentary"],
  ["app", "synthetic-saas-pl.csv"],
  ["app", "analyzeFile"],
  ["variance", "parseWorkbook"],
  ["variance", "normalizeFinancialRecords"],
  ["variance", "forecast_risk"],
  ["projects", "Variance Memo"],
  ["projects", "/variance-memo/"],
  ["sitemap", "https://bortlesboat.github.io/variance-memo/"],
];

for (const [file, token] of requiredTokens) {
  if (!files[file].includes(token)) {
    throw new Error(`${file} is missing required token: ${token}`);
  }
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

if (!result.memo.markdown.includes("## Board Commentary") || !result.memo.markdown.includes("[row 2]")) {
  throw new Error("Generated memo is missing board commentary or source row references");
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

console.log("variance-memo verifier ok: public files, sitemap, project card, deterministic analysis, and privacy guardrails passed");

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}
