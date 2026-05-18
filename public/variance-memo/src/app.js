import { analyzeCsvText, analyzeFile } from "./variance.js?v=upload-ui-20260518";

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

  elements.rowCount.textContent = `${result.normalizedRows.length} rows`;
  elements.varianceCount.textContent = `${result.analysis.variances.length} variances`;
  elements.varianceRows.innerHTML = result.analysis.variances.length
    ? result.analysis.variances.map(renderVarianceRow).join("")
    : `<tr class="empty-row"><td colspan="8">No material variances found.</td></tr>`;
  elements.importAudit.innerHTML = renderImportAudit(result.importReport);
  elements.previewRows.innerHTML = renderPreviewRows(result.importReport);
  elements.driverNotes.innerHTML = result.memo.driverNotes.length
    ? result.memo.driverNotes.map(renderDriverNote).join("")
    : `<li>No forecast driver notes generated.</li>`;
  elements.memoOutput.textContent = result.memo.markdown;
  elements.sheetCheck.textContent = result.importReport?.sourceSheet || "CSV";
  elements.normalizationCheck.textContent = result.importReport?.canAnalyze ? "Mapped" : "Mapping needed";
  elements.commentaryCheck.textContent = result.memo.markdown.includes("[row ") ? "Row-linked" : "Needs review";
  elements.caveatCheck.textContent = result.memo.markdown.includes("Caveats") ? "Included" : "Missing";
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
    : `<p class="audit-good">Mapped account, actual, and budget from the uploaded file.</p>`;

  const sheets = report.sheetReports?.length
    ? `<p class="audit-muted">Workbook sheets scored: ${report.sheetReports.map((sheet) => `${escapeHtml(sheet.sourceSheet || "Sheet")} (${sheet.score})`).join(", ")}</p>`
    : "";

  return `
    <p><strong>Source:</strong> ${state.sourceMode === "demo" ? "Demo sample" : "Uploaded file"}</p>
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

function renderDriverNote(note) {
  return `<li>
    <span class="note-kind">${escapeHtml(note.kind.replaceAll("_", " "))}</span>
    <span>${escapeHtml(note.text)}</span>
  </li>`;
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
