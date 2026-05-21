const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const FIELD_SYNONYMS = {
  account: ["account", "account name", "account description", "description", "gl account", "gl account name", "line item", "line_item", "name", "p&l line", "pl line", "financial statement line"],
  category: ["category", "type", "p&l category", "pl category", "statement category"],
  department: ["department", "dept", "function", "team", "cost center", "cost centre"],
  period: ["period", "month", "date", "fiscal period"],
  actual: ["actual", "actuals", "act"],
  budget: ["budget", "plan", "planned"],
  forecast: ["forecast", "fcst", "outlook", "projection"],
  priorYear: ["prior year", "prior_year", "last year", "py", "prior year actual"],
};

const PORTFOLIO_FIELD_SYNONYMS = {
  accountNumber: ["account number", "account no", "account #"],
  accountName: ["account name", "account"],
  symbol: ["symbol", "ticker", "ticker symbol"],
  description: ["description", "security description", "security name", "holding", "position"],
  quantity: ["quantity", "qty", "shares"],
  lastPrice: ["last price", "price", "market price"],
  lastPriceChange: ["last price change", "price change"],
  currentValue: ["current value", "market value", "value"],
  todayGainLossDollar: ["today's gain/loss dollar", "todays gain/loss dollar", "day gain/loss dollar", "today gain loss dollar"],
  todayGainLossPercent: ["today's gain/loss percent", "todays gain/loss percent", "day gain/loss percent", "today gain loss percent"],
  totalGainLossDollar: ["total gain/loss dollar", "total gain loss dollar", "unrealized gain/loss dollar", "gain/loss dollar"],
  totalGainLossPercent: ["total gain/loss percent", "total gain loss percent", "unrealized gain/loss percent", "gain/loss percent"],
  percentOfAccount: ["percent of account", "% of account", "percent account"],
  costBasisTotal: ["cost basis total", "total cost basis", "cost basis"],
  averageCostBasis: ["average cost basis", "avg cost basis"],
  type: ["type", "asset type", "security type", "category"],
};

const TRANSACTION_FIELD_SYNONYMS = {
  date: ["date", "transaction date", "posted date", "post date", "posting date"],
  account: ["account", "account name", "account number"],
  description: ["description", "merchant", "payee", "name", "memo", "transaction", "details"],
  category: ["category", "type", "classification"],
  amount: ["amount", "transaction amount", "net amount"],
  debit: ["debit", "withdrawal", "withdrawals", "charge", "charges", "spent"],
  credit: ["credit", "deposit", "deposits", "payment", "payments", "received"],
  balance: ["balance", "running balance", "available balance"],
};

const INVOICE_FIELD_SYNONYMS = {
  counterparty: ["vendor", "supplier", "customer", "client", "counterparty", "payee", "payer"],
  invoiceNumber: ["invoice number", "invoice #", "invoice no", "invoice id", "document number", "bill number"],
  invoiceDate: ["invoice date", "bill date", "date"],
  dueDate: ["due date", "payment due date"],
  openAmount: ["open amount", "amount due", "balance due", "outstanding amount", "remaining balance", "amount", "invoice amount", "current balance"],
  daysPastDue: ["days past due", "days overdue", "past due days", "days late"],
  agingBucket: ["aging bucket", "age bucket", "bucket", "aging"],
  status: ["status", "invoice status", "payment status"],
};

const MEASURE_PATTERNS = [
  ["priorYear", /\b(prior[\s_-]*year|last[\s_-]*year|py)\b/i],
  ["forecast", /\b(forecast|fcst|outlook|projection)\b/i],
  ["budget", /\b(budget|plan|planned)\b/i],
  ["actual", /\b(actuals?|act)\b/i],
];

export function parseCsv(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
  const delimiter = detectDelimiter(firstLine);
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell.trim());
      pushCsvRow(rows, row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  pushCsvRow(rows, row);
  return rows;
}

export function rowsToObjects(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const headerIndex = findHeaderRowIndex(rows);
  const headers = inferHeaders(rows, headerIndex);
  return rows
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => String(cell ?? "").trim().length > 0))
    .map((row, rowIndex) => {
      const record = { __sourceRow: headerIndex + rowIndex + 2 };
      for (let index = 0; index < headers.length; index += 1) {
        record[headers[index]] = row[index] ?? "";
      }
      return record;
    });
}

export async function parseWorkbook(input) {
  const bytes = toUint8Array(input);
  const files = await unzip(bytes);
  const workbookXml = files.get("xl/workbook.xml");
  if (!workbookXml) {
    throw new Error("Workbook is missing xl/workbook.xml");
  }

  const rels = parseRelationships(files.get("xl/_rels/workbook.xml.rels") ?? "");
  const sharedStrings = parseSharedStrings(files.get("xl/sharedStrings.xml") ?? "");
  const sheets = parseWorkbookSheets(workbookXml);
  const parsedSheets = [];

  for (const sheet of sheets) {
    const target = rels.get(sheet.relationshipId) ?? `worksheets/sheet${parsedSheets.length + 1}.xml`;
    const path = normalizeWorkbookPath(target);
    const sheetXml = files.get(path);
    if (!sheetXml) {
      continue;
    }
    parsedSheets.push({
      name: sheet.name || `Sheet ${parsedSheets.length + 1}`,
      rows: parseWorksheetRows(sheetXml, sharedStrings),
    });
  }

  if (parsedSheets.length === 0) {
    throw new Error("Workbook did not contain a readable worksheet");
  }

  return { sheets: parsedSheets };
}

export function normalizeFinancialRecords(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return [];
  }

  if (Array.isArray(records[0])) {
    return normalizeFinancialRecords(rowsToObjects(records));
  }

  const headers = collectHeaders(records);
  const fieldMap = buildFieldMap(headers);
  if (!fieldMap.account) {
    return [];
  }
  const hasVerticalShape = Boolean(fieldMap.period && (fieldMap.actual || fieldMap.budget || fieldMap.forecast || fieldMap.priorYear));

  if (hasVerticalShape) {
    return normalizeVerticalRecords(records, fieldMap);
  }

  return normalizeWideRecords(records, headers, fieldMap);
}

export function inspectRows(rows, sourceSheet = "") {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      mode: "fpna_variance",
      sourceSheet,
      headerRowIndex: 0,
      headerRowNumber: 0,
      headers: [],
      mappedFields: {},
      missingRequiredFields: ["account", "actual", "budget"],
      canAnalyze: false,
      score: 0,
      previewRows: [],
    };
  }

  const headerRowIndex = findHeaderRowIndex(rows);
  const headers = inferHeaders(rows, headerRowIndex);
  const portfolioFieldMap = buildPortfolioFieldMap(headers);
  if (isPortfolioFieldMap(portfolioFieldMap)) {
    const missingRequiredFields = requiredPortfolioFieldGaps(portfolioFieldMap);
    return {
      mode: "portfolio_positions",
      sourceSheet,
      headerRowIndex,
      headerRowNumber: headerRowIndex + 1,
      headers,
      mappedFields: portfolioFieldMap,
      missingRequiredFields,
      canAnalyze: missingRequiredFields.length === 0,
      score: scoreHeaderRow(headers) + Math.min(10, countDataRowsAfterHeader(rows, headerRowIndex)),
      previewRows: rows.slice(headerRowIndex, headerRowIndex + 6),
    };
  }

  const transactionFieldMap = buildTransactionFieldMap(headers);
  if (isTransactionFieldMap(transactionFieldMap)) {
    const missingRequiredFields = requiredTransactionFieldGaps(transactionFieldMap);
    return {
      mode: "financial_transactions",
      sourceSheet,
      headerRowIndex,
      headerRowNumber: headerRowIndex + 1,
      headers,
      mappedFields: transactionFieldMap,
      missingRequiredFields,
      canAnalyze: missingRequiredFields.length === 0,
      score: scoreHeaderRow(headers) + Math.min(10, countDataRowsAfterHeader(rows, headerRowIndex)),
      previewRows: rows.slice(headerRowIndex, headerRowIndex + 6),
    };
  }

  const invoiceFieldMap = buildInvoiceFieldMap(headers);
  if (isInvoiceFieldMap(invoiceFieldMap)) {
    const missingRequiredFields = requiredInvoiceFieldGaps(invoiceFieldMap);
    return {
      mode: "invoice_aging",
      sourceSheet,
      headerRowIndex,
      headerRowNumber: headerRowIndex + 1,
      headers,
      mappedFields: invoiceFieldMap,
      missingRequiredFields,
      canAnalyze: missingRequiredFields.length === 0,
      score: scoreHeaderRow(headers) + Math.min(10, countDataRowsAfterHeader(rows, headerRowIndex)),
      previewRows: rows.slice(headerRowIndex, headerRowIndex + 6),
    };
  }

  const mappedFields = buildFieldMap(headers);
  const missingRequiredFields = requiredFieldGaps(headers, mappedFields);
  if (missingRequiredFields.length > 1 && !looksLikeFpnaExport(headers, mappedFields)) {
    return {
      mode: "unsupported_financial_file",
      sourceSheet,
      headerRowIndex,
      headerRowNumber: headerRowIndex + 1,
      headers,
      mappedFields,
      missingRequiredFields: ["supportedMode"],
      canAnalyze: false,
      score: scoreHeaderRow(headers) + Math.min(10, countDataRowsAfterHeader(rows, headerRowIndex)),
      previewRows: rows.slice(headerRowIndex, headerRowIndex + 6),
    };
  }

  return {
    mode: "fpna_variance",
    sourceSheet,
    headerRowIndex,
    headerRowNumber: headerRowIndex + 1,
    headers,
    mappedFields,
    missingRequiredFields,
    canAnalyze: missingRequiredFields.length === 0,
    score: scoreHeaderRow(headers) + Math.min(10, countDataRowsAfterHeader(rows, headerRowIndex)),
    previewRows: rows.slice(headerRowIndex, headerRowIndex + 6),
  };
}

export function analyzeVariance(rows, options = {}) {
  const dollarThreshold = options.dollarThreshold ?? 5000;
  const percentThreshold = options.percentThreshold ?? 0.1;
  const variances = [];

  for (const row of rows) {
    if (!Number.isFinite(row.actual) || !Number.isFinite(row.budget)) {
      continue;
    }

    const lineType = classifyLineType(row);
    const comparableActual = comparableValue(row.actual, lineType);
    const comparableBudget = comparableValue(row.budget, lineType);
    const variance = comparableActual - comparableBudget;
    const variancePct = comparableBudget === 0 ? null : variance / Math.abs(comparableBudget);
    const material = Math.abs(variance) >= dollarThreshold || (variancePct !== null && Math.abs(variancePct) >= percentThreshold);
    if (!material) {
      continue;
    }

    const favorability = lineType === "expense" ? (variance <= 0 ? "favorable" : "unfavorable") : variance >= 0 ? "favorable" : "unfavorable";

    variances.push({
      rowRef: row.sourceRow,
      period: row.period,
      account: row.account,
      category: row.category,
      department: row.department,
      actual: comparableActual,
      budget: comparableBudget,
      forecast: row.forecast,
      priorYear: row.priorYear,
      variance,
      variancePct,
      favorability,
      lineType,
      confidence: confidenceFor(row, lineType, variancePct),
      sourceColumns: row.sourceColumns ?? {},
    });
  }

  variances.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
  const driverNotes = generateDriverNotes(variances);

  return {
    generatedAt: new Date().toISOString(),
    variances,
    driverNotes,
    summary: summarizeVariances(variances),
  };
}

export function buildBoardMemo(analysis) {
  const variances = analysis.variances ?? [];
  const driverNotes = analysis.driverNotes ?? generateDriverNotes(variances);
  const topFavorable = variances.filter((row) => row.favorability === "favorable").slice(0, 4);
  const topUnfavorable = variances.filter((row) => row.favorability === "unfavorable").slice(0, 4);
  const lines = [];

  lines.push("## Analyst Draft");
  if (variances.length === 0) {
    lines.push("- No material actual-vs-budget variances were detected using the selected thresholds, or the importer could not map account, actual, and budget columns from the uploaded file.");
  } else {
    lines.push(`- The file shows ${variances.length} material actual-vs-budget variance${variances.length === 1 ? "" : "s"} at the selected thresholds.`);
    if (topFavorable[0]) {
      lines.push(`- Largest favorable variance: ${varianceSentence(topFavorable[0])}`);
    }
    if (topUnfavorable[0]) {
      lines.push(`- Largest unfavorable variance: ${varianceSentence(topUnfavorable[0])}`);
    }
  }

  lines.push("");
  lines.push("## What the file supports");
  for (const variance of variances.slice(0, 8)) {
    lines.push(`- ${varianceSentence(variance)}`);
  }

  lines.push("");
  lines.push("## Possible drivers to investigate");
  if (driverNotes.length === 0) {
    lines.push("- No forecast risk or opportunity notes were generated from mapped forecast columns.");
  } else {
    for (const note of driverNotes.slice(0, 8)) {
      lines.push(`- [row ${note.rowRefs.join(", row ")}] ${note.text}`);
    }
  }

  lines.push("");
  lines.push("## Draft commentary");
  if (variances.length === 0) {
    lines.push("No board-level variance explanation was generated without a material variance anchor from mapped account, actual, and budget rows.");
  } else {
    for (const variance of variances.slice(0, 4)) {
      lines.push(`${commentarySentence(variance)}`);
    }
  }

  lines.push("");
  lines.push("## Needs context before sending");
  lines.push("- Confirm whether each variance is timing, volume/rate, mix, accrual/classification, or one-time activity.");
  lines.push("- Commentary is generated from mapped rows only; it does not know contracts, invoices, headcount changes, or management decisions.");
  lines.push("- Rows without account, actual, and budget values are excluded from material variance ranking.");

  return {
    markdown: lines.join("\n"),
    varianceTable: variances,
    driverNotes,
  };
}

export function buildDiagnosticMode(analysis, importReport = {}) {
  const mode = importReport?.mode ?? modeFromAnalysis(analysis);
  const supports = diagnosticSupports(analysis, importReport, mode);
  const rowsToUseNext = diagnosticRowsToUseNext(analysis, mode);
  const cannotProve = diagnosticCannotProve(mode);
  const advisoryAgenda = diagnosticAdvisoryAgenda(analysis, importReport, mode, rowsToUseNext);
  const automationQuestions = diagnosticAutomationQuestions(mode);
  const anonymizedSummary = diagnosticAnonymizedSummary(analysis, importReport, mode);
  const markdown = diagnosticMarkdown({
    supports,
    rowsToUseNext,
    cannotProve,
    advisoryAgenda,
    automationQuestions,
    anonymizedSummary,
  });

  return {
    supports,
    rowsToUseNext,
    cannotProve,
    advisoryAgenda,
    automationQuestions,
    anonymizedSummary,
    markdown,
  };
}

export function buildDiagnosticPacket(result) {
  const importReport = result?.importReport ?? {};
  const analysis = result?.analysis ?? {};
  const diagnostic = result?.diagnosticMode ?? buildDiagnosticMode(analysis, importReport);
  const lines = [
    "# Finance File Triage Diagnostic Packet",
    "",
    "Private finance-file diagnostic preflight",
    "",
    "Use this packet to prepare for a finance review call without pretending the file proves more than it does. Run it on synthetic or sanitized finance exports before anything leaves the room.",
    "",
    "## File basis",
  ];

  appendBullets(lines, diagnosticFileBasis(importReport, analysis));
  lines.push("", "## What the file supports");
  appendBullets(lines, diagnostic.supports);
  lines.push("", "## Rows to use next");
  if ((diagnostic.rowsToUseNext ?? []).length > 0) {
    appendBullets(lines, diagnostic.rowsToUseNext.slice(0, 5).map((item) => item.text));
  } else {
    lines.push("- No reusable memo or call-agenda rows were identified because this file did not map to row-linked evidence.");
  }
  lines.push("", "## What this file cannot prove");
  appendBullets(lines, diagnostic.cannotProve);
  lines.push("", "## Safe advisory call agenda");
  appendBullets(lines, diagnostic.advisoryAgenda);
  lines.push("", "## Automation questions to ask");
  appendBullets(lines, diagnostic.automationQuestions);
  lines.push("", "## Caveated anonymized summary", diagnostic.anonymizedSummary);
  lines.push("", "## Sharing boundary");
  appendBullets(lines, [
    "Before sharing externally, remove company names, account identifiers, counterparties, transaction descriptions, security names, amounts, departments, and local file paths.",
    "Treat this as a diagnostic packet, not a board-ready conclusion, investment recommendation, payment instruction, or accounting position.",
  ]);

  return {
    markdown: lines.join("\n"),
  };
}

function withDiagnosticMode(result) {
  const diagnosticMode = buildDiagnosticMode(result.analysis, result.importReport);
  const diagnosticPacket = buildDiagnosticPacket({ ...result, diagnosticMode });
  return {
    ...result,
    diagnosticMode,
    diagnosticPacket,
    memo: {
      ...result.memo,
      markdown: `${result.memo.markdown}\n\n${diagnosticMode.markdown}`,
    },
  };
}

export async function analyzeFile(file, options = {}) {
  const name = file?.name?.toLowerCase() ?? "";
  if (name.endsWith(".xlsx")) {
    const workbook = await parseWorkbook(await file.arrayBuffer());
    return {
      fileName: file.name,
      ...analyzeWorkbook(workbook, options),
    };
  } else {
    return {
      fileName: file.name,
      ...analyzeRows(parseCsv(await file.text()), options, { sourceSheet: "CSV" }),
    };
  }
}

export function analyzeWorkbook(workbook, options = {}) {
  const sheets = workbook?.sheets ?? [];
  const sheetReports = sheets.map((sheet) => inspectRows(sheet.rows, sheet.name));
  const bestReport = sheetReports.toSorted((a, b) => b.score - a.score)[0] ?? inspectRows([], "");
  const sheet = sheets.find((candidate) => candidate.name === bestReport.sourceSheet) ?? sheets[0] ?? { rows: [] };
  return analyzeRows(sheet.rows, options, {
    sourceSheet: sheet.name ?? "",
    sheetReports,
  });
}

export function analyzeCsvText(text, options = {}) {
  return analyzeRows(parseCsv(text), options, { sourceSheet: "CSV" });
}

export function analyzeRows(rows, options = {}, context = {}) {
  const importReport = inspectRows(rows, context.sourceSheet ?? "");
  const records = rowsToObjects(rows);
  if (importReport.mode === "portfolio_positions") {
    const positions = normalizePortfolioPositions(records, importReport.mappedFields);
    const analysis = analyzePortfolioPositions(positions, options);
    return withDiagnosticMode({
      rows,
      records,
      normalizedRows: positions,
      importReport: {
        ...importReport,
        canAnalyze: positions.length > 0 && importReport.missingRequiredFields.length === 0,
        normalizedRowCount: positions.length,
        positionCount: positions.length,
        varianceCount: 0,
        sheetReports: context.sheetReports ?? [],
      },
      analysis,
      memo: buildPortfolioMemo(analysis),
    });
  }

  if (importReport.mode === "financial_transactions") {
    const transactions = normalizeFinancialTransactions(records, importReport.mappedFields);
    const analysis = analyzeFinancialTransactions(transactions, options);
    return withDiagnosticMode({
      rows,
      records,
      normalizedRows: transactions,
      importReport: {
        ...importReport,
        canAnalyze: transactions.length > 0 && importReport.missingRequiredFields.length === 0,
        normalizedRowCount: transactions.length,
        transactionCount: transactions.length,
        varianceCount: 0,
        sheetReports: context.sheetReports ?? [],
      },
      analysis,
      memo: buildTransactionMemo(analysis),
    });
  }

  if (importReport.mode === "invoice_aging") {
    const invoices = normalizeInvoices(records, importReport.mappedFields);
    const analysis = analyzeInvoices(invoices, options);
    return withDiagnosticMode({
      rows,
      records,
      normalizedRows: invoices,
      importReport: {
        ...importReport,
        canAnalyze: invoices.length > 0 && importReport.missingRequiredFields.length === 0,
        normalizedRowCount: invoices.length,
        invoiceCount: invoices.length,
        varianceCount: 0,
        sheetReports: context.sheetReports ?? [],
      },
      analysis,
      memo: buildInvoiceMemo(analysis),
    });
  }

  if (importReport.mode === "unsupported_financial_file") {
    const analysis = analyzeUnsupportedFile(records, importReport);
    return withDiagnosticMode({
      rows,
      records,
      normalizedRows: [],
      importReport: {
        ...importReport,
        normalizedRowCount: 0,
        varianceCount: 0,
        sheetReports: context.sheetReports ?? [],
      },
      analysis,
      memo: buildUnsupportedMemo(analysis, importReport),
    });
  }

  const normalizedRows = normalizeFinancialRecords(records);
  const analysis = analyzeVariance(normalizedRows, options);
  return withDiagnosticMode({
    rows,
    records,
    normalizedRows,
    importReport: {
      ...importReport,
      normalizedRowCount: normalizedRows.length,
      varianceCount: analysis.variances.length,
      sheetReports: context.sheetReports ?? [],
    },
    analysis,
    memo: buildBoardMemo(analysis),
  });
}

function normalizeVerticalRecords(records, fieldMap) {
  return records
    .map((record, index) => ({
      sourceRow: record.__sourceRow ?? index + 1,
      period: cleanValue(record[fieldMap.period]) || "Unspecified period",
      account: cleanValue(record[fieldMap.account]) || "Unspecified account",
      category: cleanValue(record[fieldMap.category]) || inferCategory(record[fieldMap.account]),
      department: cleanValue(record[fieldMap.department]) || "Unassigned",
      actual: parseAmount(record[fieldMap.actual]),
      budget: parseAmount(record[fieldMap.budget]),
      forecast: parseAmount(record[fieldMap.forecast]),
      priorYear: parseAmount(record[fieldMap.priorYear]),
      sourceColumns: omitNullish({
        actual: fieldMap.actual,
        budget: fieldMap.budget,
        forecast: fieldMap.forecast,
        priorYear: fieldMap.priorYear,
      }),
    }))
    .filter((row) => row.actual !== null || row.budget !== null || row.forecast !== null || row.priorYear !== null);
}

function normalizeWideRecords(records, headers, fieldMap) {
  const keyColumns = new Set([fieldMap.account, fieldMap.category, fieldMap.department].filter(Boolean));
  const measureColumns = headers
    .filter((header) => !keyColumns.has(header) && header !== "__sourceRow")
    .map((header) => ({ header, parsed: parseMeasureHeader(header) }))
    .filter((column) => column.parsed);
  const rows = [];

  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex];
    const groups = new Map();

    for (const { header, parsed } of measureColumns) {
      const amount = parseAmount(record[header]);
      if (amount === null) {
        continue;
      }

      const group = groups.get(parsed.period) ?? {
        sourceRow: record.__sourceRow ?? recordIndex + 1,
        period: parsed.period,
        account: cleanValue(record[fieldMap.account]) || "Unspecified account",
        category: cleanValue(record[fieldMap.category]) || inferCategory(record[fieldMap.account]),
        department: cleanValue(record[fieldMap.department]) || "Unassigned",
        actual: null,
        budget: null,
        forecast: null,
        priorYear: null,
        sourceColumns: {},
      };

      group[parsed.measure] = amount;
      group.sourceColumns[parsed.measure] = header;
      groups.set(parsed.period, group);
    }

    rows.push(...groups.values());
  }

  return rows;
}

function normalizePortfolioPositions(records, fieldMap) {
  return records
    .map((record, index) => {
      const currentValue = parseAmount(record[fieldMap.currentValue]);
      const symbol = cleanValue(record[fieldMap.symbol]);
      const description = cleanValue(record[fieldMap.description]);
      if (currentValue === null || (!symbol && !description)) {
        return null;
      }

      return {
        sourceRow: record.__sourceRow ?? index + 1,
        accountNumber: cleanValue(record[fieldMap.accountNumber]),
        accountName: cleanValue(record[fieldMap.accountName]) || "Unspecified account",
        symbol: symbol || "Unspecified symbol",
        description: description || symbol || "Unspecified holding",
        quantity: parseAmount(record[fieldMap.quantity]),
        lastPrice: parseAmount(record[fieldMap.lastPrice]),
        lastPriceChange: parseAmount(record[fieldMap.lastPriceChange]),
        currentValue,
        todayGainLossDollar: parseAmount(record[fieldMap.todayGainLossDollar]),
        todayGainLossPercent: parsePercent(record[fieldMap.todayGainLossPercent]),
        totalGainLossDollar: parseAmount(record[fieldMap.totalGainLossDollar]),
        totalGainLossPercent: parsePercent(record[fieldMap.totalGainLossPercent]),
        percentOfAccount: parsePercent(record[fieldMap.percentOfAccount]),
        costBasisTotal: parseAmount(record[fieldMap.costBasisTotal]),
        averageCostBasis: parseAmount(record[fieldMap.averageCostBasis]),
        type: cleanValue(record[fieldMap.type]) || inferPositionType(symbol, description),
      };
    })
    .filter(Boolean);
}

function analyzePortfolioPositions(positions) {
  const sortedPositions = [...positions].sort((a, b) => Math.abs(b.currentValue) - Math.abs(a.currentValue));
  const totalValue = positions.reduce((sum, position) => sum + position.currentValue, 0);
  const cashValue = positions.filter(isCashPosition).reduce((sum, position) => sum + position.currentValue, 0);
  const costBasisTotal = sumFinite(positions.map((position) => position.costBasisTotal));
  const totalGainLossDollar = sumFinite(positions.map((position) => position.totalGainLossDollar));
  const summary = {
    positionCount: positions.length,
    accountCount: countDistinct(positions.map((position) => position.accountName || position.accountNumber).filter(Boolean)),
    totalValue,
    cashValue,
    cashPercent: totalValue === 0 ? null : cashValue / totalValue,
    costBasisTotal,
    totalGainLossDollar,
    totalGainLossPercent: costBasisTotal ? totalGainLossDollar / costBasisTotal : null,
  };
  const assetMix = groupPositions(positions, "type", totalValue);
  const accountMix = groupPositions(positions, "accountName", totalValue);
  const topPositions = sortedPositions.slice(0, 10).map((position) => ({
    ...position,
    percentOfPortfolio: totalValue === 0 ? null : position.currentValue / totalValue,
  }));
  const driverNotes = generatePortfolioNotes({ positions, summary, topPositions, assetMix, accountMix });

  return {
    kind: "portfolio",
    generatedAt: new Date().toISOString(),
    positions,
    topPositions,
    assetMix,
    accountMix,
    driverNotes,
    variances: [],
    summary,
  };
}

function buildPortfolioMemo(analysis) {
  const lines = [];
  const summary = analysis.summary;
  const topPosition = analysis.topPositions[0];
  const topAccount = analysis.accountMix[0];

  lines.push("## Portfolio Snapshot");
  if (summary.positionCount === 0) {
    lines.push("- No portfolio positions were detected from the uploaded file.");
  } else {
    lines.push(`- The file maps ${summary.positionCount} position${summary.positionCount === 1 ? "" : "s"} across ${summary.accountCount} account${summary.accountCount === 1 ? "" : "s"} with parsed current value of ${formatCurrency(summary.totalValue)}.`);
    if (topPosition) {
      lines.push(`- Largest position: ${portfolioPositionSentence(topPosition)}.`);
    }
    if (summary.cashValue > 0) {
      lines.push(`- Cash and money-market rows total ${formatCurrency(summary.cashValue)}${summary.cashPercent === null ? "" : ` (${formatPercent(summary.cashPercent)} of parsed value)`}.`);
    }
    if (Number.isFinite(summary.totalGainLossDollar) && summary.costBasisTotal > 0) {
      lines.push(`- Rows with cost basis show total gain/loss of ${formatCurrency(summary.totalGainLossDollar)}${summary.totalGainLossPercent === null ? "" : ` (${formatPercent(summary.totalGainLossPercent)})`}.`);
    }
  }

  lines.push("");
  lines.push("## Largest positions");
  if (analysis.topPositions.length === 0) {
    lines.push("- No ranked positions available.");
  } else {
    for (const position of analysis.topPositions.slice(0, 8)) {
      lines.push(`- ${portfolioPositionSentence(position)}.`);
    }
  }

  lines.push("");
  lines.push("## Account and type mix");
  if (topAccount) {
    lines.push(`- Largest account bucket: ${topAccount.label} at ${formatCurrency(topAccount.value)} (${formatPercent(topAccount.percentOfPortfolio)} of parsed value).`);
  }
  for (const bucket of analysis.assetMix.slice(0, 6)) {
    lines.push(`- ${bucket.label}: ${formatCurrency(bucket.value)} (${formatPercent(bucket.percentOfPortfolio)}), ${bucket.count} row${bucket.count === 1 ? "" : "s"}.`);
  }

  lines.push("");
  lines.push("## Checks to run");
  for (const note of analysis.driverNotes.slice(0, 8)) {
    lines.push(`- [row ${note.rowRefs.join(", row ")}] ${note.text}`);
  }

  lines.push("");
  lines.push("## Needs context before acting");
  lines.push("- This is a position-file summary, not investment advice or a recommendation to buy, sell, rebalance, or change allocations.");
  lines.push("- Verify prices, unsettled activity, account ownership, tax status, and whether rows are duplicated across account sections before using this in a decision.");
  lines.push("- The file does not explain goals, time horizon, cash needs, risk tolerance, outside accounts, or tax constraints.");

  return {
    markdown: lines.join("\n"),
    varianceTable: [],
    driverNotes: analysis.driverNotes,
  };
}

function normalizeFinancialTransactions(records, fieldMap) {
  return records
    .map((record, index) => {
      const amount = transactionAmount(record, fieldMap);
      const description = cleanValue(record[fieldMap.description]);
      if (!Number.isFinite(amount) || !description) {
        return null;
      }

      return {
        sourceRow: record.__sourceRow ?? index + 1,
        date: cleanValue(record[fieldMap.date]) || "Unspecified date",
        account: cleanValue(record[fieldMap.account]) || "Unspecified account",
        description,
        category: cleanValue(record[fieldMap.category]) || "Uncategorized",
        amount,
        direction: amount >= 0 ? "inflow" : "outflow",
        balance: parseAmount(record[fieldMap.balance]),
      };
    })
    .filter(Boolean);
}

function analyzeFinancialTransactions(transactions) {
  const totalInflows = transactions.filter((transaction) => transaction.amount > 0).reduce((sum, transaction) => sum + transaction.amount, 0);
  const totalOutflows = Math.abs(transactions.filter((transaction) => transaction.amount < 0).reduce((sum, transaction) => sum + transaction.amount, 0));
  const netCashFlow = totalInflows - totalOutflows;
  const sortedTransactions = [...transactions].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const summary = {
    transactionCount: transactions.length,
    accountCount: countDistinct(transactions.map((transaction) => transaction.account).filter(Boolean)),
    totalInflows,
    totalOutflows,
    netCashFlow,
    dateRange: transactionDateRange(transactions),
  };
  const largestTransactions = sortedTransactions.slice(0, 10);
  const categoryMix = groupTransactions(transactions, "category");
  const accountMix = groupTransactions(transactions, "account");
  const driverNotes = generateTransactionNotes({ transactions, summary, largestTransactions, categoryMix, accountMix });

  return {
    kind: "transactions",
    generatedAt: new Date().toISOString(),
    transactions,
    largestTransactions,
    categoryMix,
    accountMix,
    driverNotes,
    variances: [],
    summary,
  };
}

function buildTransactionMemo(analysis) {
  const summary = analysis.summary;
  const lines = [];

  lines.push("## Cash Activity Snapshot");
  if (summary.transactionCount === 0) {
    lines.push("- No transactions were detected from the uploaded file.");
  } else {
    const range = summary.dateRange.start && summary.dateRange.end ? ` from ${summary.dateRange.start} to ${summary.dateRange.end}` : "";
    lines.push(`- The file maps ${summary.transactionCount} transaction${summary.transactionCount === 1 ? "" : "s"} across ${summary.accountCount} account${summary.accountCount === 1 ? "" : "s"}${range}.`);
    lines.push(`- Parsed inflows total ${formatCurrency(summary.totalInflows)}, outflows total ${formatCurrency(summary.totalOutflows)}, and net cash flow is ${formatCurrency(summary.netCashFlow)}.`);
  }

  lines.push("");
  lines.push("## Largest transactions");
  if (analysis.largestTransactions.length === 0) {
    lines.push("- No ranked transactions available.");
  } else {
    for (const transaction of analysis.largestTransactions.slice(0, 8)) {
      lines.push(`- ${transactionSentence(transaction)}.`);
    }
  }

  lines.push("");
  lines.push("## Category and account mix");
  for (const bucket of analysis.categoryMix.slice(0, 6)) {
    lines.push(`- ${bucket.label}: ${formatCurrency(bucket.netAmount)} net, ${formatCurrency(bucket.outflows)} outflows, ${formatCurrency(bucket.inflows)} inflows across ${bucket.count} transaction${bucket.count === 1 ? "" : "s"}.`);
  }
  const topAccount = analysis.accountMix[0];
  if (topAccount) {
    lines.push(`- Largest account bucket by absolute activity: ${topAccount.label} at ${formatCurrency(topAccount.absoluteActivity)} across ${topAccount.count} transaction${topAccount.count === 1 ? "" : "s"}.`);
  }

  lines.push("");
  lines.push("## Checks to run");
  for (const note of analysis.driverNotes.slice(0, 8)) {
    lines.push(`- [row ${note.rowRefs.join(", row ")}] ${note.text}`);
  }

  lines.push("");
  lines.push("## Needs context before acting");
  lines.push("- This is a transaction-file summary, not tax, budgeting, accounting, or investment advice.");
  lines.push("- Verify pending/duplicate transactions, transfer treatment, refunds, split categories, account ownership, and whether debits/credits use the expected sign convention.");
  lines.push("- The file does not know your monthly budget, income timing, savings targets, taxes, or whether a transaction is reimbursable or one-time.");

  return {
    markdown: lines.join("\n"),
    varianceTable: [],
    driverNotes: analysis.driverNotes,
  };
}

function normalizeInvoices(records, fieldMap) {
  return records
    .map((record, index) => {
      const openAmount = parseAmount(record[fieldMap.openAmount]);
      const counterparty = cleanValue(record[fieldMap.counterparty]);
      if (!counterparty || !Number.isFinite(openAmount)) {
        return null;
      }

      const daysPastDue = parseAmount(record[fieldMap.daysPastDue]);
      return {
        sourceRow: record.__sourceRow ?? index + 1,
        counterparty,
        invoiceNumber: cleanValue(record[fieldMap.invoiceNumber]) || "Unspecified invoice",
        invoiceDate: cleanValue(record[fieldMap.invoiceDate]) || "Unspecified invoice date",
        dueDate: cleanValue(record[fieldMap.dueDate]) || "Unspecified due date",
        openAmount,
        daysPastDue: Number.isFinite(daysPastDue) ? daysPastDue : inferDaysPastDue(record[fieldMap.agingBucket]),
        agingBucket: cleanValue(record[fieldMap.agingBucket]) || "Unbucketed",
        status: cleanValue(record[fieldMap.status]) || "Unspecified status",
      };
    })
    .filter(Boolean);
}

function analyzeInvoices(invoices) {
  const openAmount = invoices.reduce((sum, invoice) => sum + invoice.openAmount, 0);
  const overdueAmount = invoices.filter(isOverdueInvoice).reduce((sum, invoice) => sum + invoice.openAmount, 0);
  const currentAmount = openAmount - overdueAmount;
  const summary = {
    invoiceCount: invoices.length,
    counterpartyCount: countDistinct(invoices.map((invoice) => invoice.counterparty)),
    openAmount,
    overdueAmount,
    currentAmount,
    disputedAmount: invoices.filter((invoice) => /\b(dispute|disputed|hold)\b/i.test(invoice.status)).reduce((sum, invoice) => sum + invoice.openAmount, 0),
  };
  const largestInvoices = [...invoices].sort((a, b) => Math.abs(b.openAmount) - Math.abs(a.openAmount)).slice(0, 10);
  const counterpartyMix = groupInvoices(invoices, "counterparty");
  const agingMix = groupInvoices(invoices, "agingBucket");
  const driverNotes = generateInvoiceNotes({ invoices, summary, largestInvoices, counterpartyMix, agingMix });

  return {
    kind: "invoices",
    generatedAt: new Date().toISOString(),
    invoices,
    largestInvoices,
    counterpartyMix,
    agingMix,
    driverNotes,
    variances: [],
    summary,
  };
}

function buildInvoiceMemo(analysis) {
  const lines = [];
  const summary = analysis.summary;

  lines.push("## Invoice Aging Snapshot");
  if (summary.invoiceCount === 0) {
    lines.push("- No open invoice rows were detected from the uploaded file.");
  } else {
    lines.push(`- The file maps ${summary.invoiceCount} invoice${summary.invoiceCount === 1 ? "" : "s"} across ${summary.counterpartyCount} counterparty bucket${summary.counterpartyCount === 1 ? "" : "s"}.`);
    lines.push(`- Open amount totals ${formatCurrency(summary.openAmount)}; ${formatCurrency(summary.overdueAmount)} appears overdue and ${formatCurrency(summary.currentAmount)} appears current.`);
    if (summary.disputedAmount > 0) {
      lines.push(`- Disputed/on-hold rows total ${formatCurrency(summary.disputedAmount)} based on parsed status fields.`);
    }
  }

  lines.push("");
  lines.push("## Largest open invoices");
  if (analysis.largestInvoices.length === 0) {
    lines.push("- No ranked invoices available.");
  } else {
    for (const invoice of analysis.largestInvoices.slice(0, 8)) {
      lines.push(`- ${invoiceSentence(invoice)}.`);
    }
  }

  lines.push("");
  lines.push("## Counterparty and aging mix");
  for (const bucket of analysis.counterpartyMix.slice(0, 6)) {
    lines.push(`- ${bucket.label}: ${formatCurrency(bucket.openAmount)} open across ${bucket.count} invoice${bucket.count === 1 ? "" : "s"}.`);
  }
  for (const bucket of analysis.agingMix.slice(0, 6)) {
    lines.push(`- ${bucket.label}: ${formatCurrency(bucket.openAmount)} open, ${bucket.count} invoice${bucket.count === 1 ? "" : "s"}.`);
  }

  lines.push("");
  lines.push("## Checks to run");
  for (const note of analysis.driverNotes.slice(0, 8)) {
    lines.push(`- [row ${note.rowRefs.join(", row ")}] ${note.text}`);
  }

  lines.push("");
  lines.push("## Needs context before acting");
  lines.push("- This is an invoice aging summary, not a collections, payment, accounting, or cash-management instruction.");
  lines.push("- Verify whether this is AP or AR, whether credits/prepayments are included, disputed invoices, payment plans, duplicate invoices, and cutoff date.");
  lines.push("- The file does not know contract terms, vendor/customer relationships, approval status, payment holds, or cash constraints.");

  return {
    markdown: lines.join("\n"),
    varianceTable: [],
    driverNotes: analysis.driverNotes,
  };
}

function analyzeUnsupportedFile(records, importReport) {
  return {
    kind: "unsupported",
    generatedAt: new Date().toISOString(),
    rowCount: records.length,
    headers: importReport.headers ?? [],
    variances: [],
    driverNotes: [],
    summary: {
      rowCount: records.length,
      columnCount: importReport.headers?.length ?? 0,
    },
  };
}

function buildUnsupportedMemo(analysis, importReport) {
  const columns = (importReport.headers ?? []).filter(Boolean);
  const lines = [];
  lines.push("## Unsupported File Structure");
  lines.push(`- The file parsed ${analysis.summary.rowCount} data row${analysis.summary.rowCount === 1 ? "" : "s"} and ${analysis.summary.columnCount} detected column${analysis.summary.columnCount === 1 ? "" : "s"}, but it did not match a supported analysis mode.`);
  lines.push(`- Detected columns: ${columns.slice(0, 12).join(", ") || "none"}.`);
  lines.push("");
  lines.push("## Supported modes");
  lines.push("- FP&A variance: account/line item plus actual and budget, with optional forecast/prior-year.");
  lines.push("- Portfolio positions: symbol or holding description plus current value, type, cost basis, and gain/loss fields.");
  lines.push("- Financial transactions: date, description, and amount or debit/credit fields.");
  lines.push("- Invoice aging: counterparty, invoice/open amount, and due-date/aging/status fields.");
  lines.push("");
  lines.push("## Next adapter candidates");
  lines.push("- Add this file family with a synthetic fixture if it appears repeatedly.");
  lines.push("- Do not use this output as analysis until the file maps to a supported mode.");
  return {
    markdown: lines.join("\n"),
    varianceTable: [],
    driverNotes: [],
  };
}

function modeFromAnalysis(analysis) {
  if (analysis?.kind === "portfolio") {
    return "portfolio_positions";
  }
  if (analysis?.kind === "transactions") {
    return "financial_transactions";
  }
  if (analysis?.kind === "invoices") {
    return "invoice_aging";
  }
  if (analysis?.kind === "unsupported") {
    return "unsupported_financial_file";
  }
  return "fpna_variance";
}

function diagnosticSupports(analysis, importReport, mode) {
  const mappedCount = Object.keys(importReport?.mappedFields ?? {}).length;
  const normalizedCount = importReport?.normalizedRowCount ?? 0;

  if (mode === "portfolio_positions") {
    const rowRefs = rowRefsText((analysis?.topPositions ?? []).map((position) => position.sourceRow));
    return [
      `Supports a row-linked positions review for ${normalizedCount} parsed holding row${normalizedCount === 1 ? "" : "s"}${rowRefs ? `, led by ${rowRefs}` : ""}.`,
      `Supports checking concentration, account/type mix, cash bucket treatment, and missing cost-basis fields from ${mappedCount} mapped field${mappedCount === 1 ? "" : "s"}.`,
    ];
  }

  if (mode === "financial_transactions") {
    const rowRefs = rowRefsText((analysis?.largestTransactions ?? []).map((transaction) => transaction.sourceRow));
    return [
      `Supports a row-linked cash activity review for ${analysis?.summary?.transactionCount ?? normalizedCount} parsed transaction${(analysis?.summary?.transactionCount ?? normalizedCount) === 1 ? "" : "s"}${rowRefs ? `, led by ${rowRefs}` : ""}.`,
      `Supports checking inflow/outflow totals, large transaction anchors, account activity, transfer treatment, and category buckets from ${mappedCount} mapped field${mappedCount === 1 ? "" : "s"}.`,
    ];
  }

  if (mode === "invoice_aging") {
    const rowRefs = rowRefsText((analysis?.largestInvoices ?? []).map((invoice) => invoice.sourceRow));
    return [
      `Supports a row-linked invoice aging review for ${analysis?.summary?.invoiceCount ?? normalizedCount} parsed invoice row${(analysis?.summary?.invoiceCount ?? normalizedCount) === 1 ? "" : "s"}${rowRefs ? `, led by ${rowRefs}` : ""}.`,
      `Supports checking open amount, overdue buckets, disputed/on-hold rows, and counterparty concentration from ${mappedCount} mapped field${mappedCount === 1 ? "" : "s"}.`,
    ];
  }

  if (mode === "unsupported_financial_file") {
    return [
      `Supports only file-family triage: ${importReport?.headers?.length ?? 0} columns and ${analysis?.summary?.rowCount ?? 0} data row${(analysis?.summary?.rowCount ?? 0) === 1 ? "" : "s"} parsed without a supported adapter.`,
      "Supports deciding whether a new synthetic fixture and adapter are worth adding before any analysis is trusted.",
    ];
  }

  const variances = analysis?.variances ?? [];
  const rowRefs = rowRefsText(variances.map((variance) => variance.rowRef));
  const supports = [
    variances.length > 0
      ? `Supports row-linked review of ${variances.length} material actual-vs-budget variance${variances.length === 1 ? "" : "s"}${rowRefs ? `, led by ${rowRefs}` : ""}.`
      : "Supports mapping quality and threshold review, but no material actual-vs-budget variance was found at the selected thresholds.",
    `Supports checking ${normalizedCount} normalized row${normalizedCount === 1 ? "" : "s"}, ${mappedCount} mapped field${mappedCount === 1 ? "" : "s"}, and the detected header row before drafting commentary.`,
  ];
  if ((analysis?.driverNotes ?? []).length > 0) {
    supports.push("Supports a forecast-risk/opportunity prompt from mapped forecast columns, but only as an investigation queue.");
  }
  return supports;
}

function diagnosticRowsToUseNext(analysis, mode) {
  const items = [];
  const seen = new Set();

  if (mode === "portfolio_positions") {
    const topPosition = analysis?.topPositions?.[0];
    if (topPosition) {
      addDiagnosticRow(items, seen, [topPosition.sourceRow], `review agenda: inspect largest parsed position ${portfolioPositionSentence(topPosition)} before using the summary.`);
    }
  } else if (mode === "financial_transactions") {
    const largest = analysis?.largestTransactions?.[0];
    if (largest) {
      addDiagnosticRow(items, seen, [largest.sourceRow], `review agenda: inspect largest parsed transaction ${transactionSentence(largest)} before using totals.`);
    }
  } else if (mode === "invoice_aging") {
    const largest = analysis?.largestInvoices?.[0];
    if (largest) {
      addDiagnosticRow(items, seen, [largest.sourceRow], `review agenda: inspect largest parsed invoice ${invoiceSentence(largest)} before using the aging summary.`);
    }
  } else if (mode === "fpna_variance") {
    const variances = [...(analysis?.variances ?? [])].sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
    if (variances[0]) {
      addDiagnosticRow(items, seen, [variances[0].rowRef], `memo lead: ${varianceSentence(variances[0])}`);
    }
    for (const variance of variances.slice(1, 4)) {
      addDiagnosticRow(items, seen, [variance.rowRef], `review agenda: validate whether ${variance.account} is timing, volume/rate, mix, accrual, classification, or one-time activity (row ${variance.rowRef}).`);
    }
  }

  for (const note of (analysis?.driverNotes ?? []).slice(0, 4)) {
    addDiagnosticRow(items, seen, note.rowRefs, `review agenda: ${note.text}`);
  }

  return items;
}

function diagnosticCannotProve(mode) {
  if (mode === "portfolio_positions") {
    return [
      "Cannot prove investment suitability, allocation quality, tax impact, outside holdings, liquidity needs, or whether a trade should be made.",
      "Cannot prove prices, unsettled activity, duplicated account sections, account ownership, or risk tolerance without brokerage and client context.",
    ];
  }

  if (mode === "financial_transactions") {
    return [
      "Cannot prove recurring intent, reimbursement status, tax treatment, personal/business classification, or whether a transaction is one-time.",
      "Cannot prove pending/duplicate status, transfer exclusions, split categories, or account ownership without source-system context.",
    ];
  }

  if (mode === "invoice_aging") {
    return [
      "Cannot prove collectability, payment authorization, vendor/customer relationship, duplicate invoice status, or whether a hold/dispute is valid.",
      "Cannot prove AP versus AR treatment, cutoff completeness, contract terms, payment plans, or cash constraints without controller context.",
    ];
  }

  if (mode === "unsupported_financial_file") {
    return [
      "Cannot prove any finance conclusion until the file maps to a supported mode or a new adapter is built from synthetic examples.",
      "Cannot prove row meaning, source-system reliability, period coverage, or whether totals are complete from column names alone.",
    ];
  }

  return [
    "Cannot prove root cause: volume, pricing, timing, churn, mix, vendor behavior, headcount, accruals, or classification need owner context.",
    "Cannot prove data completeness, source-system accuracy, period cutoff, management intent, or whether a variance should become external commentary.",
  ];
}

function diagnosticAdvisoryAgenda(analysis, importReport, mode, rowsToUseNext = []) {
  const rowRefs = rowsToUseNext.flatMap((item) => item.rowRefs ?? []);
  const fallbackRowRefs = diagnosticRowRefs(analysis, mode);
  const rowPhrase = rowRefs.length ? rowRefsText(rowRefs) : fallbackRowRefs.length ? rowRefsText(fallbackRowRefs) : "the mapped rows";
  const modeName = diagnosticModeName(mode).toLowerCase();

  return [
    `90-minute review agenda: first 10 minutes confirm source, period, owner, privacy boundary, and whether only synthetic or sanitized rows may be discussed.`,
    `Use ${rowPhrase} as the memo lead sequence, then separate what the ${modeName} file supports from what still needs corroborating evidence.`,
    `Next 25 minutes walk ${rowPhrase} and separate what the ${modeName} file supports from what still needs corroborating evidence.`,
    "Next 25 minutes list missing context, decision owners, and follow-up evidence needed before commentary or recommendations leave the room.",
    "Next 20 minutes identify repeatable automation candidates, stable fields, thresholds, exception rules, and review handoffs.",
    "Final 10 minutes agree on a caveated anonymized summary and the next safe artifact to share.",
  ];
}

function diagnosticAutomationQuestions(mode) {
  const shared = [
    "What recurring export produces this file, who owns it, and how often does it refresh?",
    "Which columns are stable identifiers versus presentation labels, and which mapped fields break across exports?",
    "What thresholds, business rules, or review queues decide which rows deserve human attention?",
  ];

  if (mode === "portfolio_positions") {
    return [
      ...shared,
      "Which checks should be automated for concentration, cash buckets, missing cost basis, duplicate positions, and stale prices?",
    ];
  }

  if (mode === "financial_transactions") {
    return [
      ...shared,
      "Which rules classify transfers, refunds, reimbursements, duplicate transactions, and recurring activity before totals are trusted?",
    ];
  }

  if (mode === "invoice_aging") {
    return [
      ...shared,
      "Which fields prove AP/AR direction, dispute status, payment holds, duplicate invoices, cutoff, and owner follow-up?",
    ];
  }

  if (mode === "unsupported_financial_file") {
    return [
      ...shared,
      "What synthetic fixture would represent this file family without exposing private account, counterparty, employer, or local-path data?",
    ];
  }

  return [
    ...shared,
    "Which upstream systems hold the missing context for timing, volume/rate, mix, churn, vendor, headcount, accrual, and classification explanations?",
  ];
}

function diagnosticAnonymizedSummary(analysis, importReport, mode) {
  const modeName = diagnosticModeName(mode);
  const normalizedCount = importReport?.normalizedRowCount ?? 0;
  const anchorCount = diagnosticAnchorCount(analysis, mode);
  return `An anonymized ${modeName} file was triaged locally in the browser. It mapped ${normalizedCount} row${normalizedCount === 1 ? "" : "s"} and produced ${anchorCount} row-linked review anchor${anchorCount === 1 ? "" : "s"}. Treat this as a diagnostic draft only; remove company, account, counterparty, transaction, security, department, amount, and local path details before sharing externally.`;
}

function diagnosticMarkdown({ supports, rowsToUseNext = [], cannotProve, advisoryAgenda, automationQuestions, anonymizedSummary }) {
  const lines = ["## Diagnostic Mode", "", "### What the file supports"];
  appendBullets(lines, supports);
  lines.push("", "## Rows to use next");
  if (rowsToUseNext.length > 0) {
    appendBullets(lines, rowsToUseNext.slice(0, 5).map((item) => item.text));
  } else {
    lines.push("- No reusable memo or call-agenda rows were identified because this file did not map to row-linked evidence.");
  }
  lines.push("", "## What this file cannot prove");
  appendBullets(lines, cannotProve);
  lines.push("", "## Safe advisory call agenda");
  appendBullets(lines, advisoryAgenda);
  lines.push("", "## Automation questions to ask");
  appendBullets(lines, automationQuestions);
  lines.push("", "## Caveated anonymized summary", anonymizedSummary);
  return lines.join("\n");
}

function diagnosticFileBasis(importReport, analysis) {
  const mode = importReport?.mode ?? modeFromAnalysis(analysis);
  const mappedFields = Object.entries(importReport?.mappedFields ?? {});
  const normalizedCount = importReport?.normalizedRowCount ?? 0;
  const source = importReport?.sourceSheet ? `${importReport.sourceSheet}, header row ${importReport.headerRowNumber ?? "not found"}` : `CSV, header row ${importReport?.headerRowNumber ?? "not found"}`;
  const mappedText = mappedFields.length
    ? mappedFields.map(([field, column]) => `${field}: ${column}`).join("; ")
    : "no fields mapped";

  return [
    `Detected mode: ${diagnosticModeName(mode)}.`,
    `Source basis: ${source}.`,
    `Rows mapped: ${normalizedCount}.`,
    `Mapped fields: ${mappedText}.`,
    `Refused inference category: ${diagnosticRefusal(mode)}.`,
  ];
}

function diagnosticRefusal(mode) {
  if (mode === "portfolio_positions") {
    return "allocation advice";
  }
  if (mode === "financial_transactions") {
    return "recurring intent";
  }
  if (mode === "invoice_aging") {
    return "payment decisions";
  }
  if (mode === "unsupported_financial_file") {
    return "finance conclusions";
  }
  return "root causes";
}

function addDiagnosticRow(items, seen, rowRefs, text) {
  const refs = [...new Set((rowRefs ?? []).filter((rowRef) => rowRef !== null && rowRef !== undefined))];
  if (refs.length === 0) {
    return;
  }
  const key = refs.join(",");
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  items.push({ rowRefs: refs, text });
}

function appendBullets(lines, items) {
  for (const item of items) {
    lines.push(`- ${item}`);
  }
}

function diagnosticRowRefs(analysis, mode) {
  if (mode === "portfolio_positions") {
    return (analysis?.topPositions ?? []).map((position) => position.sourceRow);
  }
  if (mode === "financial_transactions") {
    return (analysis?.largestTransactions ?? []).map((transaction) => transaction.sourceRow);
  }
  if (mode === "invoice_aging") {
    return (analysis?.largestInvoices ?? []).map((invoice) => invoice.sourceRow);
  }
  if (mode === "unsupported_financial_file") {
    return [];
  }
  return (analysis?.variances ?? []).map((variance) => variance.rowRef);
}

function diagnosticAnchorCount(analysis, mode) {
  if (mode === "portfolio_positions") {
    return analysis?.topPositions?.length ?? 0;
  }
  if (mode === "financial_transactions") {
    return analysis?.largestTransactions?.length ?? 0;
  }
  if (mode === "invoice_aging") {
    return analysis?.largestInvoices?.length ?? 0;
  }
  if (mode === "unsupported_financial_file") {
    return 0;
  }
  return analysis?.variances?.length ?? 0;
}

function diagnosticModeName(mode) {
  if (mode === "portfolio_positions") {
    return "portfolio positions";
  }
  if (mode === "financial_transactions") {
    return "financial transactions";
  }
  if (mode === "invoice_aging") {
    return "invoice aging";
  }
  if (mode === "unsupported_financial_file") {
    return "unsupported financial file";
  }
  return "FP&A variance";
}

function rowRefsText(rowRefs) {
  const refs = [...new Set(rowRefs.filter((rowRef) => rowRef !== null && rowRef !== undefined))]
    .slice(0, 5)
    .map((rowRef) => `row ${rowRef}`);
  if (refs.length === 0) {
    return "";
  }
  if (refs.length === 1) {
    return refs[0];
  }
  return `${refs.slice(0, -1).join(", ")} and ${refs.at(-1)}`;
}

function inferHeaders(rows, headerRowIndex) {
  const rawHeaders = rows[headerRowIndex] ?? [];
  const headers = rawHeaders.map((header, index) => String(header || `Column ${index + 1}`).trim());
  const fieldMap = buildFieldMap(headers);
  if (!fieldMap.account && !String(rawHeaders[0] ?? "").trim() && looksLikeAccountColumn(rows, headerRowIndex, 0)) {
    headers[0] = "Column 1";
  }
  return headers;
}

function looksLikeAccountColumn(rows, headerRowIndex, columnIndex) {
  const dataValues = rows
    .slice(headerRowIndex + 1, headerRowIndex + 8)
    .map((row) => String(row[columnIndex] ?? "").trim())
    .filter(Boolean);
  if (dataValues.length < 2) {
    return false;
  }
  return dataValues.every((value) => /[a-z]/i.test(value) && parseAmount(value) === null);
}

function findHeaderRowIndex(rows) {
  let bestIndex = 0;
  let bestScore = -1;
  const limit = Math.min(rows.length, 25);

  for (let index = 0; index < limit; index += 1) {
    const row = rows[index] ?? [];
    const score = scoreHeaderRow(row);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }

  return bestScore >= 2 ? bestIndex : 0;
}

function scoreHeaderRow(row) {
  const values = row.map((cell) => String(cell ?? "").trim()).filter(Boolean);
  if (values.length < 2) {
    return 0;
  }

  const fieldMap = buildFieldMap(values);
  const portfolioFieldMap = buildPortfolioFieldMap(values);
  const transactionFieldMap = buildTransactionFieldMap(values);
  const invoiceFieldMap = buildInvoiceFieldMap(values);
  const mappedFields = Object.keys(fieldMap).length;
  const measureHeaders = values.filter((value) => parseMeasureHeader(value)).length;
  const hasAccount = fieldMap.account ? 4 : 0;
  const hasComparableMeasures = fieldMap.actual && fieldMap.budget ? 4 : 0;
  const portfolioScore = isPortfolioFieldMap(portfolioFieldMap)
    ? Object.keys(portfolioFieldMap).length + (portfolioFieldMap.currentValue ? 4 : 0) + (portfolioFieldMap.symbol || portfolioFieldMap.description ? 3 : 0)
    : 0;
  const transactionScore = isTransactionFieldMap(transactionFieldMap)
    ? Object.keys(transactionFieldMap).length + (transactionFieldMap.date ? 2 : 0) + (transactionFieldMap.description ? 3 : 0) + (transactionFieldMap.amount || (transactionFieldMap.debit && transactionFieldMap.credit) ? 4 : 0)
    : 0;
  const invoiceScore = isInvoiceFieldMap(invoiceFieldMap)
    ? Object.keys(invoiceFieldMap).length + (invoiceFieldMap.counterparty ? 3 : 0) + (invoiceFieldMap.openAmount ? 4 : 0) + (invoiceFieldMap.dueDate || invoiceFieldMap.agingBucket || invoiceFieldMap.daysPastDue ? 3 : 0)
    : 0;

  return Math.max(mappedFields + measureHeaders * 2 + hasAccount + hasComparableMeasures, portfolioScore, transactionScore, invoiceScore);
}

function requiredFieldGaps(headers, fieldMap) {
  const gaps = [];
  if (!fieldMap.account) {
    gaps.push("account");
  }

  const hasVerticalMeasures = Boolean(fieldMap.actual && fieldMap.budget);
  const wideMeasures = headers.map((header) => parseMeasureHeader(header)).filter(Boolean);
  const wideMeasureNames = new Set(wideMeasures.map((measure) => measure.measure));
  const hasWideMeasures = wideMeasureNames.has("actual") && wideMeasureNames.has("budget");

  if (!hasVerticalMeasures && !hasWideMeasures) {
    gaps.push("actual");
    gaps.push("budget");
  }

  return gaps;
}

function countDataRowsAfterHeader(rows, headerRowIndex) {
  return rows
    .slice(headerRowIndex + 1)
    .filter((row) => row.some((cell) => String(cell ?? "").trim().length > 0)).length;
}

function parseMeasureHeader(header) {
  const cleanHeader = String(header ?? "").trim();
  for (const [measure, pattern] of MEASURE_PATTERNS) {
    if (pattern.test(cleanHeader)) {
      const period = cleanHeader
        .replace(pattern, "")
        .replace(/[_|/\\-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (period) {
        return { measure, period };
      }
    }
  }
  return null;
}

function buildFieldMap(headers) {
  const fieldMap = {};
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (!fieldMap.account && normalized === "column 1") {
      fieldMap.account = header;
      continue;
    }
    for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS)) {
      if (!fieldMap[field] && synonyms.some((synonym) => normalizeHeader(synonym) === normalized)) {
        fieldMap[field] = header;
      }
    }
  }
  return fieldMap;
}

function buildPortfolioFieldMap(headers) {
  const fieldMap = {};
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    for (const [field, synonyms] of Object.entries(PORTFOLIO_FIELD_SYNONYMS)) {
      if (!fieldMap[field] && synonyms.some((synonym) => normalizeHeader(synonym) === normalized)) {
        fieldMap[field] = header;
      }
    }
  }
  return fieldMap;
}

function buildTransactionFieldMap(headers) {
  const fieldMap = {};
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    for (const [field, synonyms] of Object.entries(TRANSACTION_FIELD_SYNONYMS)) {
      if (!fieldMap[field] && synonyms.some((synonym) => normalizeHeader(synonym) === normalized)) {
        fieldMap[field] = header;
      }
    }
  }
  return fieldMap;
}

function buildInvoiceFieldMap(headers) {
  const fieldMap = {};
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    for (const [field, synonyms] of Object.entries(INVOICE_FIELD_SYNONYMS)) {
      if (!fieldMap[field] && synonyms.some((synonym) => normalizeHeader(synonym) === normalized)) {
        fieldMap[field] = header;
      }
    }
  }
  return fieldMap;
}

function isPortfolioFieldMap(fieldMap) {
  return Boolean(fieldMap.currentValue && (fieldMap.symbol || fieldMap.description) && (fieldMap.quantity || fieldMap.type || fieldMap.accountName));
}

function isTransactionFieldMap(fieldMap) {
  return Boolean(fieldMap.description && fieldMap.date && (fieldMap.amount || fieldMap.debit || fieldMap.credit));
}

function isInvoiceFieldMap(fieldMap) {
  return Boolean(fieldMap.counterparty && fieldMap.openAmount && (fieldMap.invoiceNumber || fieldMap.dueDate || fieldMap.agingBucket || fieldMap.daysPastDue || fieldMap.status));
}

function requiredPortfolioFieldGaps(fieldMap) {
  const gaps = [];
  if (!fieldMap.currentValue) {
    gaps.push("currentValue");
  }
  if (!fieldMap.symbol && !fieldMap.description) {
    gaps.push("symbol");
  }
  return gaps;
}

function requiredTransactionFieldGaps(fieldMap) {
  const gaps = [];
  if (!fieldMap.date) {
    gaps.push("date");
  }
  if (!fieldMap.description) {
    gaps.push("description");
  }
  if (!fieldMap.amount && !fieldMap.debit && !fieldMap.credit) {
    gaps.push("amount");
  }
  return gaps;
}

function requiredInvoiceFieldGaps(fieldMap) {
  const gaps = [];
  if (!fieldMap.counterparty) {
    gaps.push("counterparty");
  }
  if (!fieldMap.openAmount) {
    gaps.push("openAmount");
  }
  return gaps;
}

function looksLikeFpnaExport(headers, fieldMap) {
  if (fieldMap.actual || fieldMap.budget || fieldMap.forecast || fieldMap.priorYear) {
    return true;
  }
  const wideMeasures = headers.map((header) => parseMeasureHeader(header)).filter(Boolean);
  return wideMeasures.length > 0;
}

function collectHeaders(records) {
  const seen = new Set();
  const headers = [];
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }
  return headers;
}

function parseAmount(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const raw = String(value).trim();
  if (!raw || raw === "-" || raw.toLowerCase() === "n/a") {
    return null;
  }

  const isParenthetical = /^\(.*\)$/.test(raw);
  const cleaned = raw
    .replace(/[,$%]/g, "")
    .replace(/[()]/g, "")
    .replace(/\s+/g, "");
  const number = Number(cleaned);
  if (!Number.isFinite(number)) {
    return null;
  }
  return isParenthetical ? -number : number;
}

function parsePercent(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const raw = String(value).trim();
  const amount = parseAmount(raw);
  if (amount === null) {
    return null;
  }
  return raw.includes("%") || Math.abs(amount) > 1 ? amount / 100 : amount;
}

function transactionAmount(record, fieldMap) {
  if (fieldMap.amount) {
    return parseAmount(record[fieldMap.amount]);
  }
  const debit = parseAmount(record[fieldMap.debit]) ?? 0;
  const credit = parseAmount(record[fieldMap.credit]) ?? 0;
  if (debit === 0 && credit === 0) {
    return null;
  }
  return credit - debit;
}

function classifyLineType(row) {
  const haystack = `${row.category ?? ""} ${row.account ?? ""}`.toLowerCase();
  if (/\b(revenue|sales|income|arr|mrr|bookings)\b/.test(haystack)) {
    return "revenue";
  }
  if (/\b(cogs|cost|expense|opex|payroll|hosting|marketing|spend|software|contractor)\b/.test(haystack)) {
    return "expense";
  }
  return "unknown";
}

function comparableValue(value, lineType) {
  if (lineType === "expense" && value < 0) {
    return Math.abs(value);
  }
  return value;
}

function confidenceFor(row, lineType, variancePct) {
  if (lineType === "unknown") {
    return "medium";
  }
  if (variancePct === null) {
    return "medium";
  }
  return row.sourceColumns?.actual && row.sourceColumns?.budget ? "high" : "medium";
}

function generateDriverNotes(variances) {
  const notes = [];

  for (const variance of variances) {
    if (Number.isFinite(variance.forecast) && Number.isFinite(variance.budget)) {
      const comparableForecast = comparableValue(variance.forecast, variance.lineType);
      const forecastVariance = comparableForecast - variance.budget;
      const isRisk =
        (variance.lineType === "revenue" && forecastVariance < 0) ||
        (variance.lineType === "expense" && forecastVariance > 0) ||
        (variance.favorability === "unfavorable" && Math.sign(forecastVariance) === Math.sign(variance.variance));
      const isOpportunity =
        (variance.lineType === "revenue" && forecastVariance > 0) ||
        (variance.lineType === "expense" && forecastVariance < 0);

      if (isRisk) {
        notes.push({
          kind: "forecast_risk",
          severity: "watch",
          rowRefs: [variance.rowRef],
          text: `${variance.account} carries forecast risk: forecast is ${formatCurrency(Math.abs(forecastVariance))} ${forecastVariance >= 0 ? "above" : "below"} budget while the current variance is ${variance.favorability}.`,
        });
      } else if (isOpportunity) {
        notes.push({
          kind: "forecast_opportunity",
          severity: "upside",
          rowRefs: [variance.rowRef],
          text: `${variance.account} shows forecast opportunity: forecast is ${formatCurrency(Math.abs(forecastVariance))} ${forecastVariance >= 0 ? "above" : "below"} budget after a ${variance.favorability} actuals variance.`,
        });
      }

      if (Math.abs(forecastVariance) < Math.abs(variance.variance) * 0.35) {
        notes.push({
          kind: "timing",
          severity: "context",
          rowRefs: [variance.rowRef],
          text: `${variance.account} may be timing-driven because the forecast variance is much smaller than the actuals variance.`,
        });
      }
    }

    if (variance.department !== "Unassigned" && Math.abs(variance.variance) >= 10000) {
      notes.push({
        kind: "department_concentration",
        severity: variance.favorability === "unfavorable" ? "watch" : "context",
        rowRefs: [variance.rowRef],
        text: `${variance.department} drives a material ${variance.account} variance of ${formatCurrency(Math.abs(variance.variance))}.`,
      });
    }
  }

  return notes;
}

function summarizeVariances(variances) {
  return {
    count: variances.length,
    favorable: variances.filter((variance) => variance.favorability === "favorable").length,
    unfavorable: variances.filter((variance) => variance.favorability === "unfavorable").length,
    totalAbsoluteVariance: variances.reduce((sum, variance) => sum + Math.abs(variance.variance), 0),
  };
}

function generatePortfolioNotes({ positions, summary, topPositions, assetMix, accountMix }) {
  const notes = [];
  const topPosition = topPositions[0];
  if (topPosition && topPosition.percentOfPortfolio !== null) {
    notes.push({
      kind: "position_concentration",
      severity: topPosition.percentOfPortfolio >= 0.2 ? "watch" : "context",
      rowRefs: [topPosition.sourceRow],
      text: `${topPosition.symbol} is the largest parsed position at ${formatCurrency(topPosition.currentValue)} (${formatPercent(topPosition.percentOfPortfolio)} of parsed value).`,
    });
  }

  const topAccount = accountMix[0];
  if (topAccount && topAccount.percentOfPortfolio >= 0.5 && summary.accountCount > 1) {
    notes.push({
      kind: "account_concentration",
      severity: "context",
      rowRefs: topAccount.rowRefs.slice(0, 3),
      text: `${topAccount.label} holds ${formatPercent(topAccount.percentOfPortfolio)} of parsed value across ${topAccount.count} row${topAccount.count === 1 ? "" : "s"}.`,
    });
  }

  if (summary.cashValue > 0) {
    const cashRows = positions.filter(isCashPosition).map((position) => position.sourceRow);
    notes.push({
      kind: "cash_bucket",
      severity: "context",
      rowRefs: cashRows.slice(0, 5),
      text: `Cash or money-market rows total ${formatCurrency(summary.cashValue)}${summary.cashPercent === null ? "" : ` (${formatPercent(summary.cashPercent)} of parsed value)`}.`,
    });
  }

  const missingCostBasis = positions.filter((position) => position.costBasisTotal === null && !isCashPosition(position));
  if (missingCostBasis.length > 0) {
    notes.push({
      kind: "missing_cost_basis",
      severity: "watch",
      rowRefs: missingCostBasis.slice(0, 5).map((position) => position.sourceRow),
      text: `${missingCostBasis.length} non-cash position row${missingCostBasis.length === 1 ? "" : "s"} did not include parsed cost basis, so total gain/loss may be incomplete.`,
    });
  }

  const largestType = assetMix[0];
  if (largestType) {
    notes.push({
      kind: "type_mix",
      severity: "context",
      rowRefs: largestType.rowRefs.slice(0, 5),
      text: `${largestType.label} is the largest parsed type bucket at ${formatCurrency(largestType.value)} (${formatPercent(largestType.percentOfPortfolio)}).`,
    });
  }

  return notes;
}

function generateTransactionNotes({ summary, largestTransactions, categoryMix, accountMix }) {
  const notes = [];
  const largest = largestTransactions[0];
  if (largest) {
    notes.push({
      kind: "largest_transaction",
      severity: "context",
      rowRefs: [largest.sourceRow],
      text: `${largest.description} is the largest parsed transaction at ${formatCurrency(Math.abs(largest.amount))} ${largest.direction}.`,
    });
  }

  const topOutflowCategory = categoryMix.find((bucket) => bucket.outflows > 0);
  if (topOutflowCategory) {
    notes.push({
      kind: "outflow_category",
      severity: "context",
      rowRefs: topOutflowCategory.rowRefs.slice(0, 5),
      text: `${topOutflowCategory.label} is the largest outflow category at ${formatCurrency(topOutflowCategory.outflows)} across ${topOutflowCategory.count} transaction${topOutflowCategory.count === 1 ? "" : "s"}.`,
    });
  }

  const topAccount = accountMix[0];
  if (topAccount && summary.accountCount > 1) {
    notes.push({
      kind: "account_activity",
      severity: "context",
      rowRefs: topAccount.rowRefs.slice(0, 5),
      text: `${topAccount.label} has the most parsed activity at ${formatCurrency(topAccount.absoluteActivity)} across ${topAccount.count} transaction${topAccount.count === 1 ? "" : "s"}.`,
    });
  }

  const transferBucket = categoryMix.find((bucket) => /\btransfer\b/i.test(bucket.label));
  if (transferBucket) {
    notes.push({
      kind: "transfer_treatment",
      severity: "watch",
      rowRefs: transferBucket.rowRefs.slice(0, 5),
      text: `Transfers appear in the file; confirm whether to exclude them from spend or income views before using totals.`,
    });
  }

  if (summary.netCashFlow < 0) {
    notes.push({
      kind: "negative_net_cash_flow",
      severity: "watch",
      rowRefs: largestTransactions.slice(0, 3).map((transaction) => transaction.sourceRow),
      text: `Parsed outflows exceed inflows by ${formatCurrency(Math.abs(summary.netCashFlow))} for this file period.`,
    });
  }

  return notes;
}

function generateInvoiceNotes({ invoices, summary, largestInvoices, counterpartyMix, agingMix }) {
  const notes = [];
  const largest = largestInvoices[0];
  if (largest) {
    notes.push({
      kind: "largest_invoice",
      severity: "context",
      rowRefs: [largest.sourceRow],
      text: `${largest.counterparty} has the largest parsed open invoice at ${formatCurrency(largest.openAmount)}.`,
    });
  }

  const oldest = [...invoices].sort((a, b) => (b.daysPastDue ?? 0) - (a.daysPastDue ?? 0))[0];
  if (oldest && oldest.daysPastDue > 0) {
    notes.push({
      kind: "oldest_past_due",
      severity: oldest.daysPastDue >= 60 ? "watch" : "context",
      rowRefs: [oldest.sourceRow],
      text: `${oldest.counterparty} has a parsed invoice ${oldest.daysPastDue} days past due for ${formatCurrency(oldest.openAmount)}.`,
    });
  }

  const topCounterparty = counterpartyMix[0];
  if (topCounterparty && summary.counterpartyCount > 1) {
    notes.push({
      kind: "counterparty_concentration",
      severity: "context",
      rowRefs: topCounterparty.rowRefs.slice(0, 5),
      text: `${topCounterparty.label} is the largest counterparty bucket at ${formatCurrency(topCounterparty.openAmount)} open.`,
    });
  }

  const oldestBucket = agingMix.find((bucket) => /60|90|\+|over|past/i.test(bucket.label));
  if (oldestBucket) {
    notes.push({
      kind: "aging_bucket",
      severity: "watch",
      rowRefs: oldestBucket.rowRefs.slice(0, 5),
      text: `${oldestBucket.label} contains ${formatCurrency(oldestBucket.openAmount)} open across ${oldestBucket.count} invoice${oldestBucket.count === 1 ? "" : "s"}.`,
    });
  }

  if (summary.disputedAmount > 0) {
    const disputedRows = invoices.filter((invoice) => /\b(dispute|disputed|hold)\b/i.test(invoice.status)).map((invoice) => invoice.sourceRow);
    notes.push({
      kind: "disputed_amount",
      severity: "watch",
      rowRefs: disputedRows.slice(0, 5),
      text: `Disputed/on-hold rows total ${formatCurrency(summary.disputedAmount)}; separate these before collections or payment decisions.`,
    });
  }

  return notes;
}

function groupPositions(positions, field, totalValue) {
  const groups = new Map();
  for (const position of positions) {
    const label = cleanValue(position[field]) || "Unspecified";
    const group = groups.get(label) ?? { label, value: 0, count: 0, rowRefs: [] };
    group.value += position.currentValue;
    group.count += 1;
    group.rowRefs.push(position.sourceRow);
    groups.set(label, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      percentOfPortfolio: totalValue === 0 ? 0 : group.value / totalValue,
    }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

function groupInvoices(invoices, field) {
  const groups = new Map();
  for (const invoice of invoices) {
    const label = cleanValue(invoice[field]) || "Unspecified";
    const group = groups.get(label) ?? { label, openAmount: 0, count: 0, rowRefs: [] };
    group.openAmount += invoice.openAmount;
    group.count += 1;
    group.rowRefs.push(invoice.sourceRow);
    groups.set(label, group);
  }
  return [...groups.values()].sort((a, b) => Math.abs(b.openAmount) - Math.abs(a.openAmount));
}

function groupTransactions(transactions, field) {
  const groups = new Map();
  for (const transaction of transactions) {
    const label = cleanValue(transaction[field]) || "Unspecified";
    const group = groups.get(label) ?? { label, netAmount: 0, inflows: 0, outflows: 0, absoluteActivity: 0, count: 0, rowRefs: [] };
    group.netAmount += transaction.amount;
    if (transaction.amount >= 0) {
      group.inflows += transaction.amount;
    } else {
      group.outflows += Math.abs(transaction.amount);
    }
    group.absoluteActivity += Math.abs(transaction.amount);
    group.count += 1;
    group.rowRefs.push(transaction.sourceRow);
    groups.set(label, group);
  }
  return [...groups.values()].sort((a, b) => b.absoluteActivity - a.absoluteActivity);
}

function transactionDateRange(transactions) {
  const dates = transactions.map((transaction) => transaction.date).filter((date) => date && date !== "Unspecified date").sort();
  return {
    start: dates[0] ?? "",
    end: dates.at(-1) ?? "",
  };
}

function isOverdueInvoice(invoice) {
  if (Number.isFinite(invoice.daysPastDue) && invoice.daysPastDue > 0) {
    return true;
  }
  return /\b(past|overdue|1-30|31-60|61-90|90|\+)\b/i.test(invoice.agingBucket);
}

function inferDaysPastDue(value) {
  const bucket = cleanValue(value).toLowerCase();
  if (!bucket || /\bcurrent\b/.test(bucket)) {
    return 0;
  }
  const match = bucket.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function sumFinite(values) {
  return values.reduce((sum, value) => (Number.isFinite(value) ? sum + value : sum), 0);
}

function countDistinct(values) {
  return new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)).size;
}

function isCashPosition(position) {
  const haystack = `${position.type ?? ""} ${position.symbol ?? ""} ${position.description ?? ""}`.toLowerCase();
  return /\b(cash|money market|treasury|settlement|sweep)\b/.test(haystack) || /\b(spaxx|fdrxx|fdlxx|vmfxx)\b/.test(haystack);
}

function inferPositionType(symbol, description) {
  const haystack = `${symbol ?? ""} ${description ?? ""}`.toLowerCase();
  if (/\b(cash|money market|sweep)\b/.test(haystack) || /\b(spaxx|fdrxx|fdlxx|vmfxx)\b/.test(haystack)) {
    return "Cash";
  }
  return "Unclassified";
}

function varianceSentence(variance) {
  const pct = variance.variancePct === null ? "n/a" : formatPercent(Math.abs(variance.variancePct));
  return `[row ${variance.rowRef}] ${variance.account} (${variance.department}, ${variance.period}) is ${variance.favorability} by ${formatCurrency(Math.abs(variance.variance))} (${pct}); actual ${formatCurrency(variance.actual)} vs budget ${formatCurrency(variance.budget)}.`;
}

function portfolioPositionSentence(position) {
  const pct = position.percentOfPortfolio === null ? "" : `, ${formatPercent(position.percentOfPortfolio)} of parsed value`;
  const gainLoss = Number.isFinite(position.totalGainLossDollar) ? `, total gain/loss ${formatCurrency(position.totalGainLossDollar)}` : "";
  return `[row ${position.sourceRow}] ${position.symbol} - ${position.description} (${position.type}) is ${formatCurrency(position.currentValue)}${pct}${gainLoss}`;
}

function transactionSentence(transaction) {
  return `[row ${transaction.sourceRow}] ${transaction.date} ${transaction.description} (${transaction.category}, ${transaction.account}) is ${transaction.direction} ${formatCurrency(Math.abs(transaction.amount))}${Number.isFinite(transaction.balance) ? `; balance ${formatCurrency(transaction.balance)}` : ""}`;
}

function invoiceSentence(invoice) {
  const pastDue = Number.isFinite(invoice.daysPastDue) ? `, ${invoice.daysPastDue} days past due` : "";
  return `[row ${invoice.sourceRow}] ${invoice.counterparty} invoice ${invoice.invoiceNumber} is open for ${formatCurrency(invoice.openAmount)} due ${invoice.dueDate}${pastDue} (${invoice.agingBucket}, ${invoice.status})`;
}

function commentarySentence(variance) {
  const direction = variance.variance >= 0 ? "above budget" : "below budget";
  const contextPrompt = variance.lineType === "revenue"
    ? "needs context on volume, pricing, timing, churn, or mix"
    : "needs context on timing, accruals, vendor activity, headcount, or classification";
  return `${variance.account} was ${direction} by ${formatCurrency(Math.abs(variance.variance))} in ${variance.period} [row ${variance.rowRef}]; this ${contextPrompt}.`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function inferCategory(account) {
  const accountName = cleanValue(account);
  if (!accountName) {
    return "Uncategorized";
  }
  return classifyLineType({ account: accountName, category: "" }) === "revenue" ? "Revenue" : "Expense";
}

function cleanValue(value) {
  return String(value ?? "").trim();
}

function normalizeHeader(header) {
  return String(header ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function omitNullish(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null && value !== undefined && value !== ""));
}

function pushCsvRow(rows, row) {
  if (row.some((cell) => String(cell ?? "").trim().length > 0)) {
    rows.push(row);
  }
}

function detectDelimiter(line) {
  const candidates = [",", "\t", ";"];
  let best = ",";
  let bestCount = -1;
  for (const candidate of candidates) {
    const count = countDelimiter(line, candidate);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function countDelimiter(line, delimiter) {
  let count = 0;
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && char === delimiter) {
      count += 1;
    }
  }
  return count;
}

async function unzip(bytes) {
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  const files = new Map();
  let pointer = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(pointer, true) !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory");
    }

    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const fileNameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = textDecoder.decode(bytes.slice(pointer + 46, pointer + 46 + fileNameLength));
    const data = bytes.slice(localDataOffset(view, bytes, localOffset), localDataOffset(view, bytes, localOffset) + compressedSize);

    let inflated;
    if (method === 0) {
      inflated = data;
    } else if (method === 8) {
      inflated = await inflateRaw(data);
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
    }

    files.set(name.replaceAll("\\", "/"), textDecoder.decode(inflated));
    pointer += 46 + fileNameLength + extraLength + commentLength;
  }

  return files;
}

function findEndOfCentralDirectory(bytes) {
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index -= 1) {
    if (bytes[index] === 0x50 && bytes[index + 1] === 0x4b && bytes[index + 2] === 0x05 && bytes[index + 3] === 0x06) {
      return index;
    }
  }
  throw new Error("Invalid ZIP: end of central directory not found");
}

function localDataOffset(view, bytes, localOffset) {
  if (view.getUint32(localOffset, true) !== 0x04034b50) {
    throw new Error("Invalid ZIP local header");
  }
  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  return localOffset + 30 + nameLength + extraLength;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== "undefined" && typeof Response !== "undefined" && typeof Blob !== "undefined") {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      // Fall through to Node's zlib path when available.
    }
  }

  if (typeof process !== "undefined" && process.versions?.node) {
    const { inflateRawSync } = await import("node:zlib");
    return inflateRawSync(bytes);
  }

  throw new Error("This browser cannot decompress XLSX files. Try exporting as CSV.");
}

function parseRelationships(xml) {
  const rels = new Map();
  for (const tag of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = parseAttributes(tag[1]);
    if (attrs.Id && attrs.Target) {
      rels.set(attrs.Id, attrs.Target);
    }
  }
  return rels;
}

function parseWorkbookSheets(xml) {
  return [...xml.matchAll(/<sheet\b([^>]*)\/?>/g)].map((match) => {
    const attrs = parseAttributes(match[1]);
    return {
      name: decodeXml(attrs.name ?? ""),
      relationshipId: attrs["r:id"],
    };
  });
}

function parseSharedStrings(xml) {
  if (!xml) {
    return [];
  }

  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => {
    return [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1])).join("");
  });
}

function parseWorksheetRows(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = parseAttributes(cellMatch[1]);
      const column = columnIndexFromRef(attrs.r ?? "");
      row[column] = parseCellValue(cellMatch[2], attrs.t, sharedStrings);
    }
    rows.push(row.map((cell) => cell ?? ""));
  }
  return rows;
}

function parseCellValue(xml, type, sharedStrings) {
  if (type === "inlineStr") {
    return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join("");
  }

  const valueMatch = xml.match(/<v>([\s\S]*?)<\/v>/);
  if (!valueMatch) {
    return "";
  }
  const raw = decodeXml(valueMatch[1]);
  if (type === "s") {
    return sharedStrings[Number(raw)] ?? "";
  }
  const number = Number(raw);
  return Number.isFinite(number) ? number : raw;
}

function parseAttributes(source) {
  const attrs = {};
  for (const match of String(source).matchAll(/([\w:.-]+)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function normalizeWorkbookPath(target) {
  const normalized = target.replaceAll("\\", "/").replace(/^\/+/, "");
  if (normalized.startsWith("xl/")) {
    return normalized;
  }
  return `xl/${normalized}`;
}

function columnIndexFromRef(ref) {
  const letters = String(ref).match(/^[A-Z]+/i)?.[0] ?? "A";
  let index = 0;
  for (const letter of letters.toUpperCase()) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  return index - 1;
}

function decodeXml(value) {
  return String(value ?? "")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function toUint8Array(input) {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return textEncoder.encode(String(input ?? ""));
}
