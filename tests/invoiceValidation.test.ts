import { describe, expect, it } from "vitest";
import {
  normalizeInvoice,
  parsePrintedNumber,
  validateInvoice,
} from "../src/lib/invoiceValidation";
import type { GeminiInvoiceJson } from "../src/types/invoice";

const baseInvoice: GeminiInvoiceJson = {
  documentType: "Tax Invoice",
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
  model: "gemini-2.5-flash",
  processingTimeMs: 1200,
};

describe("invoice normalization", () => {
  it("preserves column order, makes ids unique, and pads blank cells", () => {
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

    expect(normalized.columns.map((column) => column.id)).toEqual(["amount", "amount_2", "batch_no"]);
    expect(normalized.rows[0].rowNumber).toBe(1);
    expect(normalized.rows[0].values).toEqual(["10.00", null, null]);
    expect(normalized.rows[0].confidence).toBe(1);
  });
});

describe("invoice validation", () => {
  it("accepts a consistent invoice", () => {
    const issues = validateInvoice(baseInvoice);
    expect(issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
  });

  it("flags missing totals, duplicates, and invalid numeric cells", () => {
    const invoice = normalizeInvoice({
      ...baseInvoice,
      finalAmount: null,
      rows: [
        { rowNumber: 1, values: ["Medicine A", "two", "100.00"], confidence: 0.4, warnings: [] },
        { rowNumber: 2, values: ["Medicine A", "two", "100.00"], confidence: 0.9, warnings: [] },
      ],
    });

    const messages = validateInvoice(invoice).map((issue) => issue.message);
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
