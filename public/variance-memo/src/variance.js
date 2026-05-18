const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const FIELD_SYNONYMS = {
  account: ["account", "gl account", "gl account name", "line item", "line_item", "name"],
  category: ["category", "type", "p&l category", "pl category", "statement category"],
  department: ["department", "dept", "function", "team", "cost center", "cost centre"],
  period: ["period", "month", "date", "fiscal period"],
  actual: ["actual", "actuals", "act"],
  budget: ["budget", "plan", "planned"],
  forecast: ["forecast", "fcst", "outlook", "projection"],
  priorYear: ["prior year", "prior_year", "last year", "py", "prior year actual"],
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

  const headers = rows[0].map((header, index) => String(header || `Column ${index + 1}`).trim());
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => String(cell ?? "").trim().length > 0))
    .map((row, rowIndex) => {
      const record = { __sourceRow: rowIndex + 2 };
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
  const hasVerticalShape = Boolean(fieldMap.period && (fieldMap.actual || fieldMap.budget || fieldMap.forecast || fieldMap.priorYear));

  if (hasVerticalShape) {
    return normalizeVerticalRecords(records, fieldMap);
  }

  return normalizeWideRecords(records, headers, fieldMap);
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
  const topFavorable = variances.filter((row) => row.favorability === "favorable").slice(0, 3);
  const topUnfavorable = variances.filter((row) => row.favorability === "unfavorable").slice(0, 3);
  const lines = [];

  lines.push("## Executive Summary");
  if (variances.length === 0) {
    lines.push("- No material actual-vs-budget variances were detected using the selected thresholds.");
  } else {
    lines.push(`- ${variances.length} material variance${variances.length === 1 ? "" : "s"} were detected across the uploaded file.`);
    if (topFavorable[0]) {
      lines.push(`- Largest favorable item: ${varianceSentence(topFavorable[0])}`);
    }
    if (topUnfavorable[0]) {
      lines.push(`- Largest unfavorable item: ${varianceSentence(topUnfavorable[0])}`);
    }
  }

  lines.push("");
  lines.push("## Top Variances");
  for (const variance of variances.slice(0, 8)) {
    lines.push(`- ${varianceSentence(variance)}`);
  }

  lines.push("");
  lines.push("## Forecast Drivers");
  if (driverNotes.length === 0) {
    lines.push("- No forecast risk or opportunity notes were generated from the available forecast columns.");
  } else {
    for (const note of driverNotes.slice(0, 8)) {
      lines.push(`- [row ${note.rowRefs.join(", row ")}] ${note.text}`);
    }
  }

  lines.push("");
  lines.push("## Board Commentary");
  if (variances.length === 0) {
    lines.push("Actuals landed close to plan across the uploaded lines. No board-level variance explanation was generated without a material variance anchor.");
  } else {
    for (const variance of variances.slice(0, 4)) {
      lines.push(`${commentarySentence(variance)}`);
    }
  }

  lines.push("");
  lines.push("## Caveats");
  lines.push("- Commentary is generated from visible rows only; add business context before sending externally.");
  lines.push("- Rows without actual and budget values are excluded from material variance ranking.");

  return {
    markdown: lines.join("\n"),
    varianceTable: variances,
    driverNotes,
  };
}

export async function analyzeFile(file, options = {}) {
  const name = file?.name?.toLowerCase() ?? "";
  let rows;
  if (name.endsWith(".xlsx")) {
    const workbook = await parseWorkbook(await file.arrayBuffer());
    rows = workbook.sheets[0].rows;
  } else {
    rows = parseCsv(await file.text());
  }
  const records = rowsToObjects(rows);
  const normalizedRows = normalizeFinancialRecords(records);
  const analysis = analyzeVariance(normalizedRows, options);
  return {
    fileName: file.name,
    rows,
    records,
    normalizedRows,
    analysis,
    memo: buildBoardMemo(analysis),
  };
}

export function analyzeCsvText(text, options = {}) {
  const rows = parseCsv(text);
  const records = rowsToObjects(rows);
  const normalizedRows = normalizeFinancialRecords(records);
  const analysis = analyzeVariance(normalizedRows, options);
  return {
    rows,
    records,
    normalizedRows,
    analysis,
    memo: buildBoardMemo(analysis),
  };
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
    for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS)) {
      if (!fieldMap[field] && synonyms.some((synonym) => normalizeHeader(synonym) === normalized)) {
        fieldMap[field] = header;
      }
    }
  }
  return fieldMap;
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

function varianceSentence(variance) {
  const pct = variance.variancePct === null ? "n/a" : formatPercent(Math.abs(variance.variancePct));
  return `[row ${variance.rowRef}] ${variance.account} (${variance.department}, ${variance.period}) is ${variance.favorability} by ${formatCurrency(Math.abs(variance.variance))} (${pct}); actual ${formatCurrency(variance.actual)} vs budget ${formatCurrency(variance.budget)}.`;
}

function commentarySentence(variance) {
  const direction = variance.favorability === "favorable" ? "helped results" : "pressured results";
  return `${variance.account} ${direction} in ${variance.period}, with ${variance.department} actuals ${variance.favorability} to budget by ${formatCurrency(Math.abs(variance.variance))} [row ${variance.rowRef}].`;
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
