import { analyzeCsvText, analyzeFile } from "./variance.js?v=financial-router-v02-20260518";

const sampleCsv = `Account,Department,Category,Period,Actual,Budget,Forecast,Prior Year
SaaS recurring revenue,Sales,Revenue,Jan 2026,"$120,000","$100,000","$245,000","$92,000"
Expansion revenue,Expansion,Revenue,Jan 2026,"$70,000","$90,000","$150,000","$81,000"
Cloud hosting,Engineering,COGS,Jan 2026,"$42,500","$35,000","$80,000","$31,000"
Demand gen,Marketing,Expense,Jan 2026,"$30,000","$50,000","$90,000","$44,000"
Support software,Support,Expense,Jan 2026,"$18,000","$12,000","$37,000","$11,000"`;

const state = {
  result: null,
  fileName: "",
  sourceMode: "empty",
  currentFile: null,
};

const elements = {
  fileInput: document.querySelector("#fileInput"),
  chooseFileButton: document.querySelector("#chooseFileButton"),
  dropzone: document.querySelector("#dropzone"),
  fileName: document.querySelector("#fileName"),
  dollarThreshold: document.querySelector("#dollarThreshold"),
  percentThreshold: document.querySelector("#percentThreshold"),
  sampleButton: document.querySelector("#sampleButton"),
  clearButton: document.querySelector("#clearButton"),
  copyButton: document.querySelector("#copyButton"),
  exportButton: document.querySelector("#exportButton"),
  statusLabel: document.querySelector("#statusLabel"),
  rowCount: document.querySelector("#rowCount"),
  varianceCount: document.querySelector("#varianceCount"),
  analysisEyebrow: document.querySelector("#analysisEyebrow"),
  analysisTitle: document.querySelector("#analysisTitle"),
  analysisHead: document.querySelector("#analysisHead"),
  varianceRows: document.querySelector("#varianceRows"),
  importAudit: document.querySelector("#importAudit"),
  previewRows: document.querySelector("#previewRows"),
  driverNotes: document.querySelector("#driverNotes"),
  memoOutput: document.querySelector("#memoOutput"),
  sheetCheck: document.querySelector("#sheetCheck"),
  normalizationCheck: document.querySelector("#normalizationCheck"),
  commentaryCheck: document.querySelector("#commentaryCheck"),
  caveatCheck: document.querySelector("#caveatCheck"),
};

elements.chooseFileButton.addEventListener("click", () => {
  state.result = null;
  state.fileName = "";
  state.sourceMode = "upload";
  state.currentFile = null;
  elements.fileInput.value = "";
  render();
  setStatus("Choose a CSV or XLSX file");
  elements.fileInput.click();
});

elements.fileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) {
    if (!state.result) {
      state.sourceMode = "empty";
      render();
    }
    return;
  }
  state.fileName = file.name;
  state.sourceMode = "upload";
  state.currentFile = file;
  await runAnalysis(() => analyzeFile(file, thresholds()));
});

elements.sampleButton.addEventListener("click", async () => {
  state.fileName = "synthetic-saas-pl.csv";
  state.sourceMode = "demo";
  state.currentFile = null;
  elements.fileInput.value = "";
  await runAnalysis(() => Promise.resolve(analyzeCsvText(sampleCsv, thresholds())));
});

elements.clearButton.addEventListener("click", () => {
  state.result = null;
  state.fileName = "";
  state.sourceMode = "empty";
  state.currentFile = null;
  elements.fileInput.value = "";
  render();
});

elements.copyButton.addEventListener("click", async () => {
  if (!state.result) {
    return;
  }
  await navigator.clipboard.writeText(state.result.memo.markdown);
  setStatus("Copied memo");
});

elements.exportButton.addEventListener("click", () => {
  if (!state.result) {
    return;
  }
  const blob = new Blob([state.result.memo.markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "variance-memo.md";
  link.click();
  URL.revokeObjectURL(url);
  setStatus("Exported memo");
});

elements.dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  elements.dropzone.classList.add("dragging");
});

elements.dropzone.addEventListener("dragleave", () => {
  elements.dropzone.classList.remove("dragging");
});

elements.dropzone.addEventListener("drop", async (event) => {
  event.preventDefault();
  elements.dropzone.classList.remove("dragging");
  const [file] = event.dataTransfer.files;
  if (!file) {
    return;
  }
  state.fileName = file.name;
  state.sourceMode = "upload";
  state.currentFile = file;
  await runAnalysis(() => analyzeFile(file, thresholds()));
});

for (const input of [elements.dollarThreshold, elements.percentThreshold]) {
  input.addEventListener("change", async () => {
    if (state.sourceMode === "demo") {
      await runAnalysis(() => Promise.resolve(analyzeCsvText(sampleCsv, thresholds())));
    } else if (state.sourceMode === "upload" && state.currentFile) {
      await runAnalysis(() => analyzeFile(state.currentFile, thresholds()));
    }
  });
}

render();

async function runAnalysis(action) {
  setStatus("Analyzing");
  try {
    state.result = await action();
    render();
    setStatus("Ready");
  } catch (error) {
    state.result = null;
    render();
    setStatus(error instanceof Error ? error.message : "Analysis failed");
  }
}

function thresholds() {
  return {
    dollarThreshold: Number(elements.dollarThreshold.value || 0),
    percentThreshold: Number(elements.percentThreshold.value || 0) / 100,
  };
}

function render() {
  const result = state.result;
  elements.fileName.textContent = state.fileName || "No file selected";

  if (!result) {
    renderAnalysisHeader("variance");
    elements.analysisEyebrow.textContent = "Actual vs budget";
    elements.analysisTitle.textContent = "Material Variances";
    elements.rowCount.textContent = "0 rows";
    elements.varianceCount.textContent = "0 variances";
    elements.varianceRows.innerHTML = `<tr class="empty-row"><td colspan="8">No analysis loaded.</td></tr>`;
    elements.importAudit.innerHTML = `<p>No file parsed yet.</p>`;
    elements.previewRows.innerHTML = `<tr class="empty-row"><td>No parsed rows yet.</td></tr>`;
    elements.driverNotes.innerHTML = `<li>No driver notes yet.</li>`;
    elements.memoOutput.textContent = "Run an analysis to create a memo.";
    elements.sheetCheck.textContent = "Waiting";
    elements.normalizationCheck.textContent = "Waiting";
    elements.commentaryCheck.textContent = "Waiting";
    elements.caveatCheck.textContent = "Waiting";
    return;
  }

  const mode = resultMode(result);
  renderAnalysisHeader(mode);
  elements.analysisEyebrow.textContent =
    mode === "portfolio" ? "Positions file" :
    mode === "transactions" ? "Transactions file" :
    mode === "invoices" ? "Invoice file" :
    mode === "unsupported" ? "Unsupported file" :
    "Actual vs budget";
  elements.analysisTitle.textContent =
    mode === "portfolio" ? "Largest Positions" :
    mode === "transactions" ? "Cash Activity" :
    mode === "invoices" ? "Open Invoices" :
    mode === "unsupported" ? "Unsupported Structure" :
    "Material Variances";
  elements.rowCount.textContent =
    mode === "portfolio" ? `${result.analysis.summary.positionCount} positions` :
    mode === "transactions" ? `${result.analysis.summary.transactionCount} transactions` :
    mode === "invoices" ? `${result.analysis.summary.invoiceCount} invoices` :
    mode === "unsupported" ? `${result.analysis.summary.rowCount} parsed rows` :
    `${result.normalizedRows.length} rows`;
  elements.varianceCount.textContent =
    mode === "portfolio" ? `${formatCurrency(result.analysis.summary.totalValue)} parsed value` :
    mode === "transactions" ? `${formatCurrency(result.analysis.summary.netCashFlow)} net cash flow` :
    mode === "invoices" ? `${formatCurrency(result.analysis.summary.openAmount)} open` :
    mode === "unsupported" ? "unsupported" :
    `${result.analysis.variances.length} variances`;
  elements.varianceRows.innerHTML = mode === "portfolio"
    ? renderPortfolioRows(result)
    : mode === "transactions"
      ? renderTransactionRows(result)
      : mode === "invoices"
        ? renderInvoiceRows(result)
        : mode === "unsupported"
          ? renderUnsupportedRows(result)
      : result.analysis.variances.length
      ? result.analysis.variances.map(renderVarianceRow).join("")
      : `<tr class="empty-row"><td colspan="8">No material variances found.</td></tr>`;
  elements.importAudit.innerHTML = renderImportAudit(result.importReport);
  elements.previewRows.innerHTML = renderPreviewRows(result.importReport);
  elements.driverNotes.innerHTML = result.memo.driverNotes.length
    ? result.memo.driverNotes.map(renderDriverNote).join("")
    : `<li>${
        mode === "portfolio" ? "No portfolio checks generated." :
        mode === "transactions" ? "No transaction checks generated." :
        mode === "invoices" ? "No invoice checks generated." :
        mode === "unsupported" ? "No checks generated until this file maps to a supported mode." :
        "No forecast driver notes generated."
      }</li>`;
  elements.memoOutput.textContent = result.memo.markdown;
  elements.sheetCheck.textContent = result.importReport?.sourceSheet || "CSV";
  elements.normalizationCheck.textContent =
    result.importReport?.canAnalyze
      ? (mode === "portfolio" ? "Positions mapped" : mode === "transactions" ? "Transactions mapped" : mode === "invoices" ? "Invoices mapped" : "Mapped")
      : (mode === "unsupported" ? "Unsupported" : "Mapping needed");
  elements.commentaryCheck.textContent = result.memo.markdown.includes("[row ") ? "Row-linked" : "Needs review";
  elements.caveatCheck.textContent = result.memo.markdown.includes("Needs context") ? "Included" : "Missing";
}

function renderImportAudit(report) {
  if (!report) {
    return `<p>No import report available.</p>`;
  }

  const mapped = Object.entries(report.mappedFields ?? {})
    .map(([field, column]) => `<span><strong>${escapeHtml(field)}</strong>: ${escapeHtml(column)}</span>`)
    .join("");
  const missing = report.missingRequiredFields?.length
    ? `<p class="audit-warning">Missing required mapping: ${report.missingRequiredFields.map(escapeHtml).join(", ")}. No commentary should be used until this maps.</p>`
    : `<p class="audit-good">${mappedMessage(report.mode)}</p>`;

  const sheets = report.sheetReports?.length
    ? `<p class="audit-muted">Workbook sheets scored: ${report.sheetReports.map((sheet) => `${escapeHtml(sheet.sourceSheet || "Sheet")} (${sheet.score})`).join(", ")}</p>`
    : "";

  return `
    <p><strong>Source:</strong> ${state.sourceMode === "demo" ? "Demo sample" : "Uploaded file"}</p>
    <p><strong>Detected mode:</strong> ${modeLabel(report.mode)}</p>
    <p><strong>File basis:</strong> ${escapeHtml(state.fileName || "Upload")} ${report.sourceSheet ? `- sheet ${escapeHtml(report.sourceSheet)}` : ""} - header row ${report.headerRowNumber || "not found"}</p>
    <div class="mapped-fields">${mapped || "<span>No fields mapped</span>"}</div>
    ${missing}
    ${sheets}
  `;
}

function renderPreviewRows(report) {
  const rows = report?.previewRows ?? [];
  if (!rows.length) {
    return `<tr class="empty-row"><td>No parsed rows available.</td></tr>`;
  }

  return rows
    .map((row, index) => {
      const label = index === 0 ? "Detected header" : `Row ${report.headerRowNumber + index}`;
      return `<tr>
        <th>${escapeHtml(label)}</th>
        ${row.slice(0, 10).map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}
      </tr>`;
    })
    .join("");
}

function renderVarianceRow(row) {
  return `<tr>
    <td>${escapeHtml(row.rowRef)}</td>
    <td>${escapeHtml(row.period)}</td>
    <td>${escapeHtml(row.account)}</td>
    <td>${escapeHtml(row.department)}</td>
    <td>${formatCurrency(row.actual)}</td>
    <td>${formatCurrency(row.budget)}</td>
    <td class="${row.favorability === "favorable" ? "good" : "watch"}">${formatCurrency(row.variance)}</td>
    <td><span class="pill ${row.favorability}">${escapeHtml(row.favorability)}</span></td>
  </tr>`;
}

function renderPortfolioRows(result) {
  const rows = result.analysis.topPositions ?? [];
  if (!rows.length) {
    return `<tr class="empty-row"><td colspan="8">No portfolio positions found.</td></tr>`;
  }

  return rows.slice(0, 10).map(renderPortfolioRow).join("");
}

function renderPortfolioRow(row) {
  return `<tr>
    <td>${escapeHtml(row.sourceRow)}</td>
    <td>${escapeHtml(row.accountName)}</td>
    <td>${escapeHtml(row.symbol)}</td>
    <td>${escapeHtml(row.type)}</td>
    <td>${formatCurrency(row.currentValue)}</td>
    <td class="${Number(row.totalGainLossDollar) >= 0 ? "good" : "watch"}">${formatMaybeCurrency(row.totalGainLossDollar)}</td>
    <td>${formatMaybePercent(row.percentOfAccount)}</td>
    <td>${formatMaybeCurrency(row.costBasisTotal)}</td>
  </tr>`;
}

function renderTransactionRows(result) {
  const rows = result.analysis.largestTransactions ?? [];
  if (!rows.length) {
    return `<tr class="empty-row"><td colspan="8">No transactions found.</td></tr>`;
  }

  return rows.slice(0, 10).map(renderTransactionRow).join("");
}

function renderTransactionRow(row) {
  return `<tr>
    <td>${escapeHtml(row.sourceRow)}</td>
    <td>${escapeHtml(row.date)}</td>
    <td>${escapeHtml(row.account)}</td>
    <td>${escapeHtml(row.description)}</td>
    <td>${escapeHtml(row.category)}</td>
    <td class="${row.amount >= 0 ? "good" : "watch"}">${formatCurrency(row.amount)}</td>
    <td>${escapeHtml(row.direction)}</td>
    <td>${formatMaybeCurrency(row.balance)}</td>
  </tr>`;
}

function renderInvoiceRows(result) {
  const rows = result.analysis.largestInvoices ?? [];
  if (!rows.length) {
    return `<tr class="empty-row"><td colspan="8">No open invoices found.</td></tr>`;
  }

  return rows.slice(0, 10).map(renderInvoiceRow).join("");
}

function renderInvoiceRow(row) {
  return `<tr>
    <td>${escapeHtml(row.sourceRow)}</td>
    <td>${escapeHtml(row.counterparty)}</td>
    <td>${escapeHtml(row.invoiceNumber)}</td>
    <td>${escapeHtml(row.dueDate)}</td>
    <td>${formatCurrency(row.openAmount)}</td>
    <td>${formatMaybeNumber(row.daysPastDue)}</td>
    <td>${escapeHtml(row.agingBucket)}</td>
    <td>${escapeHtml(row.status)}</td>
  </tr>`;
}

function renderUnsupportedRows(result) {
  const headers = result.analysis.headers ?? [];
  if (!headers.length) {
    return `<tr class="empty-row"><td colspan="8">No columns detected.</td></tr>`;
  }

  return headers.slice(0, 8).map((header, index) => `<tr>
    <td>${index + 1}</td>
    <td colspan="7">${escapeHtml(header)}</td>
  </tr>`).join("");
}

function renderDriverNote(note) {
  return `<li>
    <span class="note-kind">${escapeHtml(note.kind.replaceAll("_", " "))}</span>
    <span>${escapeHtml(note.text)}</span>
  </li>`;
}

function renderAnalysisHeader(kind) {
  if (kind === "portfolio") {
    elements.analysisHead.innerHTML = `
      <th>Row</th>
      <th>Account</th>
      <th>Symbol</th>
      <th>Type</th>
      <th>Current Value</th>
      <th>Total G/L</th>
      <th>% Account</th>
      <th>Cost Basis</th>
    `;
    return;
  }

  if (kind === "transactions") {
    elements.analysisHead.innerHTML = `
      <th>Row</th>
      <th>Date</th>
      <th>Account</th>
      <th>Description</th>
      <th>Category</th>
      <th>Amount</th>
      <th>Direction</th>
      <th>Balance</th>
    `;
    return;
  }

  if (kind === "invoices") {
    elements.analysisHead.innerHTML = `
      <th>Row</th>
      <th>Counterparty</th>
      <th>Invoice</th>
      <th>Due Date</th>
      <th>Open Amount</th>
      <th>Days Past Due</th>
      <th>Aging</th>
      <th>Status</th>
    `;
    return;
  }

  if (kind === "unsupported") {
    elements.analysisHead.innerHTML = `
      <th>#</th>
      <th colspan="7">Detected Column</th>
    `;
    return;
  }

  elements.analysisHead.innerHTML = `
    <th>Row</th>
    <th>Period</th>
    <th>Account</th>
    <th>Dept</th>
    <th>Actual</th>
    <th>Budget</th>
    <th>Variance</th>
    <th>Fav</th>
  `;
}

function resultMode(result) {
  if (result?.analysis?.kind === "portfolio") {
    return "portfolio";
  }
  if (result?.analysis?.kind === "transactions") {
    return "transactions";
  }
  if (result?.analysis?.kind === "invoices") {
    return "invoices";
  }
  if (result?.analysis?.kind === "unsupported") {
    return "unsupported";
  }
  return "variance";
}

function modeLabel(mode) {
  if (mode === "portfolio_positions") {
    return "Portfolio positions";
  }
  if (mode === "financial_transactions") {
    return "Financial transactions";
  }
  if (mode === "invoice_aging") {
    return "Invoice aging";
  }
  if (mode === "unsupported_financial_file") {
    return "Unsupported file";
  }
  return "FP&amp;A variance";
}

function mappedMessage(mode) {
  if (mode === "portfolio_positions") {
    return "Mapped portfolio position fields from the uploaded file.";
  }
  if (mode === "financial_transactions") {
    return "Mapped transaction fields from the uploaded file.";
  }
  if (mode === "invoice_aging") {
    return "Mapped invoice aging fields from the uploaded file.";
  }
  return "Mapped account, actual, and budget from the uploaded file.";
}

function setStatus(message) {
  elements.statusLabel.textContent = message;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMaybeCurrency(value) {
  return Number.isFinite(value) ? formatCurrency(value) : "n/a";
}

function formatMaybePercent(value) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value)
    : "n/a";
}

function formatMaybeNumber(value) {
  return Number.isFinite(value) ? String(value) : "n/a";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
