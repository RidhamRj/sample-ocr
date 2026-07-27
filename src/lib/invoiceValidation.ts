import type {
  GeminiInvoiceJson,
  InvoiceColumn,
  InvoiceSummaryRow,
  InvoiceValidationIssue,
  SummaryKind,
} from "../types/invoice";

const SUMMARY_KINDS = new Set<SummaryKind>([
  "subtotal",
  "discount",
  "cgst",
  "sgst",
  "igst",
  "cess",
  "freight",
  "handling",
  "round_off",
  "taxable_amount",
  "credit_adjustment",
  "debit_adjustment",
  "final_amount",
  "other",
]);

const NUMERIC_COLUMN_PATTERN = /(^|_)(qty|quantity|free|mrp|rate|price|discount|disc|gst|tax|amount|value|total)(_|$)/i;

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
}

function clampConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

export function normalizeColumnId(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return normalized || fallback;
}

function normalizeColumns(columns: unknown): InvoiceColumn[] {
  if (!Array.isArray(columns)) return [];

  const used = new Map<string, number>();
  return columns.map((column, index) => {
    const source = column && typeof column === "object" ? column as Record<string, unknown> : {};
    const header = String(source.header ?? source.id ?? `Column ${index + 1}`).trim() || `Column ${index + 1}`;
    const baseId = normalizeColumnId(String(source.id ?? header), `column_${index + 1}`);
    const count = used.get(baseId) ?? 0;
    used.set(baseId, count + 1);
    return {
      id: count === 0 ? baseId : `${baseId}_${count + 1}`,
      header,
    };
  });
}

function normalizeSummaryRows(value: unknown): InvoiceSummaryRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const source = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const rawKind = String(source.kind ?? "other") as SummaryKind;
    return {
      label: String(source.label ?? "").trim(),
      amount: asNullableString(source.amount),
      kind: SUMMARY_KINDS.has(rawKind) ? rawKind : "other",
    };
  });
}

export function normalizeInvoice(invoice: GeminiInvoiceJson): GeminiInvoiceJson {
  const columns = normalizeColumns(invoice.columns);
  const columnCount = columns.length;

  const rows = Array.isArray(invoice.rows)
    ? invoice.rows.map((row, index) => {
        const rawValues = Array.isArray(row.values) ? row.values : [];
        const values = Array.from({ length: columnCount }, (_, columnIndex) => asNullableString(rawValues[columnIndex]));
        return {
          rowNumber: Number.isInteger(row.rowNumber) && row.rowNumber > 0 ? row.rowNumber : index + 1,
          values,
          confidence: clampConfidence(row.confidence),
          warnings: asStringArray(row.warnings),
        };
      })
    : [];

  return {
    documentType: String(invoice.documentType ?? "Invoice").trim() || "Invoice",
    tableTitle: asNullableString(invoice.tableTitle),
    currency: asNullableString(invoice.currency),
    columns,
    rows,
    summaryRows: normalizeSummaryRows(invoice.summaryRows),
    finalAmount: asNullableString(invoice.finalAmount),
    unresolvedText: asStringArray(invoice.unresolvedText),
    warnings: asStringArray(invoice.warnings),
    extractionConfidence: clampConfidence(invoice.extractionConfidence),
    model: String(invoice.model ?? "unknown"),
    processingTimeMs: typeof invoice.processingTimeMs === "number" && Number.isFinite(invoice.processingTimeMs)
      ? Math.max(0, Math.round(invoice.processingTimeMs))
      : 0,
  };
}

export function parsePrintedNumber(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const negative = /^\(.*\)$/.test(trimmed) || /^-/.test(trimmed);
  const cleaned = trimmed
    .replace(/[₹$€£¥]/g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .replace(/\/?-$/, "")
    .replace(/%$/, "")
    .replace(/[()]/g, "");

  if (!/^[-+]?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

export function validateInvoice(invoice: GeminiInvoiceJson): InvoiceValidationIssue[] {
  const issues: InvoiceValidationIssue[] = [];

  if (invoice.columns.length === 0) {
    issues.push({ severity: "error", scope: "document", message: "No product-table columns were detected." });
  }
  if (invoice.rows.length === 0) {
    issues.push({ severity: "error", scope: "document", message: "No product rows were detected." });
  }
  if (!invoice.finalAmount) {
    issues.push({ severity: "error", scope: "document", message: "The final payable amount is missing." });
  } else if (parsePrintedNumber(invoice.finalAmount) === null) {
    issues.push({ severity: "warning", scope: "document", message: `Final amount “${invoice.finalAmount}” is not a plain numeric value.` });
  }

  if (invoice.extractionConfidence !== null && invoice.extractionConfidence < 0.75) {
    issues.push({ severity: "warning", scope: "document", message: `Overall extraction confidence is ${Math.round(invoice.extractionConfidence * 100)}%.` });
  }

  const seenIds = new Set<string>();
  invoice.columns.forEach((column) => {
    if (seenIds.has(column.id)) {
      issues.push({ severity: "error", scope: "column", columnId: column.id, message: `Duplicate column identifier “${column.id}”.` });
    }
    seenIds.add(column.id);
    if (!column.header.trim()) {
      issues.push({ severity: "error", scope: "column", columnId: column.id, message: `Column “${column.id}” has no printed heading.` });
    }
  });

  const seenRows = new Map<string, number>();
  invoice.rows.forEach((row, index) => {
    if (row.values.length !== invoice.columns.length) {
      issues.push({
        severity: "error",
        scope: "row",
        rowNumber: row.rowNumber,
        message: `Row ${row.rowNumber} has ${row.values.length} cells but ${invoice.columns.length} columns exist.`,
      });
    }

    if (row.values.every((value) => value === null || !String(value).trim())) {
      issues.push({ severity: "warning", scope: "row", rowNumber: row.rowNumber, message: `Row ${row.rowNumber} is completely blank.` });
    }

    if (row.confidence !== null && row.confidence < 0.7) {
      issues.push({ severity: "warning", scope: "row", rowNumber: row.rowNumber, message: `Row ${row.rowNumber} confidence is ${Math.round(row.confidence * 100)}%.` });
    }

    const signature = row.values.map((value) => value?.trim().toLowerCase() ?? "").join("|");
    if (signature.replace(/\|/g, "")) {
      const earlier = seenRows.get(signature);
      if (earlier !== undefined) {
        issues.push({ severity: "warning", scope: "row", rowNumber: row.rowNumber, message: `Row ${row.rowNumber} duplicates row ${earlier}. Verify that Gemini did not repeat a line.` });
      } else {
        seenRows.set(signature, row.rowNumber || index + 1);
      }
    }

    row.values.forEach((value, columnIndex) => {
      const column = invoice.columns[columnIndex];
      if (!column || !value) return;
      const normalizedColumn = `${column.id}_${column.header}`.toLowerCase();
      if (NUMERIC_COLUMN_PATTERN.test(normalizedColumn) && parsePrintedNumber(value) === null) {
        issues.push({
          severity: "warning",
          scope: "row",
          rowNumber: row.rowNumber,
          columnId: column.id,
          message: `Row ${row.rowNumber}, ${column.header}: “${value}” is not a plain numeric value.`,
        });
      }
    });

    row.warnings.forEach((message) => issues.push({ severity: "warning", scope: "row", rowNumber: row.rowNumber, message }));
  });

  invoice.summaryRows.forEach((summary) => {
    if (!summary.label.trim()) {
      issues.push({ severity: "warning", scope: "summary", message: "A summary row has no label." });
    }
    if (summary.amount === null) {
      issues.push({ severity: "warning", scope: "summary", message: `${summary.label || "Summary row"} has no amount.` });
    } else if (parsePrintedNumber(summary.amount) === null) {
      issues.push({ severity: "warning", scope: "summary", message: `${summary.label || "Summary row"} amount “${summary.amount}” is not a plain numeric value.` });
    }
  });

  invoice.warnings.forEach((message) => issues.push({ severity: "warning", scope: "document", message }));
  invoice.unresolvedText.forEach((message) => issues.push({ severity: "warning", scope: "document", message: `Unresolved: ${message}` }));

  return issues;
}
