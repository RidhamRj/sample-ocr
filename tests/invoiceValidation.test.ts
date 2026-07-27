import { describe, expect, it } from "vitest";
import {
  normalizeInvoice,
  parsePrintedNumber,
  validateInvoice,
} from "../src/lib/invoiceValidation";
import type { GeminiInvoiceJson } from "../src/types/invoice";

const baseInvoice: GeminiInvoiceJson = {
  documentType: "Tax Invoice",
  supplierName: "ABC Pharma Agencies",
  invoiceNumber: "INV/0042",
  billDate: "27/07/2026",
  gstJurisdiction: "intrastate",
  tableTitle: "Items",
  currency: "INR",
  columns: [
    { id: "description", header: "PARTICULARS" },
    { id: "qty", header: "QTY" },
    { id: "amount", header: "AMOUNT" },
  ],
  rows: [
    { rowNumber: 1, values: ["Medicine A", "2", "100.00"], confidence: 0.95, warnings: [] },
  ],
  summaryRows: [
    { label: "CGST 6%", amount: "6.00", kind: "cgst" },
    { label: "SGST 6%", amount: "6.00", kind: "sgst" },
  ],
  finalAmount: "112.00",
  unresolvedText: [],
  warnings: [],
  extractionConfidence: 0.94,
  model: "gemini-3.5-flash",
  processingTimeMs: 1200,
};

describe("invoice normalization", () => {
  it("preserves metadata and column order, makes ids unique, and pads blank cells", () => {
    const normalized = normalizeInvoice({
      ...baseInvoice,
      columns: [
        { id: "Amount", header: "AMOUNT" },
        { id: "Amount", header: "AMOUNT 2" },
        { id: "", header: "Batch No." },
      ],
      rows: [
        { rowNumber: 0, values: ["10.00"], confidence: 2, warnings: [] },
      ],
    });

    expect(normalized.supplierName).toBe("ABC Pharma Agencies");
    expect(normalized.invoiceNumber).toBe("INV/0042");
    expect(normalized.billDate).toBe("27/07/2026");
    expect(normalized.gstJurisdiction).toBe("intrastate");
    expect(normalized.columns.map((column) => column.id)).toEqual(["amount", "amount_2", "column_3"]);
    expect(normalized.columns[2].header).toBe("Batch No.");
    expect(normalized.rows[0].rowNumber).toBe(1);
    expect(normalized.rows[0].values).toEqual(["10.00", null, null]);
    expect(normalized.rows[0].confidence).toBe(1);
  });

  it("normalizes an invalid GST jurisdiction to unknown", () => {
    const normalized = normalizeInvoice({
      ...baseInvoice,
      gstJurisdiction: "invalid" as GeminiInvoiceJson["gstJurisdiction"],
    });
    expect(normalized.gstJurisdiction).toBe("unknown");
  });
});

describe("invoice validation", () => {
  it("accepts a consistent invoice", () => {
    const issues = validateInvoice(baseInvoice);
    expect(issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
    expect(issues.filter((issue) => issue.severity === "warning")).toHaveLength(0);
  });

  it("flags missing metadata, totals, duplicates, and invalid numeric cells", () => {
    const invoice = normalizeInvoice({
      ...baseInvoice,
      supplierName: null,
      invoiceNumber: null,
      billDate: null,
      gstJurisdiction: "unknown",
      finalAmount: null,
      rows: [
        { rowNumber: 1, values: ["Medicine A", "two", "100.00"], confidence: 0.4, warnings: [] },
        { rowNumber: 2, values: ["Medicine A", "two", "100.00"], confidence: 0.9, warnings: [] },
      ],
    });

    const messages = validateInvoice(invoice).map((issue) => issue.message);
    expect(messages).toContain("The supplier name is missing.");
    expect(messages).toContain("The invoice number is missing.");
    expect(messages).toContain("The bill date is missing.");
    expect(messages).toContain("GST jurisdiction could not be determined confidently.");
    expect(messages).toContain("The final payable amount is missing.");
    expect(messages.some((message) => message.includes("not a plain numeric value"))).toBe(true);
    expect(messages.some((message) => message.includes("duplicates row 1"))).toBe(true);
    expect(messages.some((message) => message.includes("confidence is 40%"))).toBe(true);
  });
});

describe("printed number parsing", () => {
  it("parses common Indian invoice number formats without changing source strings", () => {
    expect(parsePrintedNumber("₹1,250.50")).toBe(1250.5);
    expect(parsePrintedNumber("(12.00)")).toBe(-12);
    expect(parsePrintedNumber("6%")).toBe(6);
    expect(parsePrintedNumber("08/28")).toBeNull();
  });
});