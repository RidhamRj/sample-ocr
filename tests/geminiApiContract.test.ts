import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  SUPPORTED_MODELS,
  extractionPrompt,
  invoiceSchema,
  resolveRequestedModel,
  validateInvoice,
} from "../api/gemini-invoice.js";

describe("Gemini API contract", () => {
  it("uses current stable models and migrates retired selections", () => {
    expect(DEFAULT_MODEL).toBe("gemini-3.5-flash");
    expect(SUPPORTED_MODELS).toContain("gemini-3.5-flash");
    expect(SUPPORTED_MODELS).not.toContain("gemini-2.5-flash");
    expect(resolveRequestedModel("gemini-2.5-flash")).toBe("gemini-3.5-flash");
    expect(resolveRequestedModel("gemini-2.5-flash-lite")).toBe("gemini-3.1-flash-lite");
    expect(resolveRequestedModel("unknown-model")).toBe(DEFAULT_MODEL);
  });

  it("uses structured nullable fields supported by Gemini", () => {
    const properties = invoiceSchema.properties as Record<string, { type?: string; nullable?: boolean }>;
    expect(properties.finalAmount.type).toBe("string");
    expect(properties.finalAmount.nullable).toBe(true);
    expect(extractionPrompt).toContain("Each row values array MUST have exactly one value for every detected column");
    expect(extractionPrompt).toContain("CGST");
    expect(extractionPrompt).toContain("finalAmount");
  });

  it("normalizes duplicate ids and preserves blank positions", () => {
    const result = validateInvoice({
      documentType: "Tax Invoice",
      tableTitle: null,
      currency: "INR",
      columns: [
        { id: "amount", header: "AMOUNT" },
        { id: "amount", header: "NET AMOUNT" },
        { id: "batch no", header: "BATCH NO" },
      ],
      rows: [
        { rowNumber: 1, values: ["10.00"], confidence: 0.8, warnings: [] },
      ],
      summaryRows: [
        { label: "CGST 6%", amount: "0.60", kind: "cgst" },
      ],
      finalAmount: "10.60",
      unresolvedText: [],
      warnings: [],
      extractionConfidence: 0.8,
    });

    expect(result.columns.map((column: { id: string }) => column.id)).toEqual(["amount", "amount_2", "batch_no"]);
    expect(result.rows[0].values).toEqual(["10.00", null, null]);
    expect(result.summaryRows[0].kind).toBe("cgst");
    expect(result.finalAmount).toBe("10.60");
  });

  it("derives an id from the printed heading when Gemini leaves id blank", () => {
    const result = validateInvoice({
      columns: [{ id: "", header: "Batch No." }],
      rows: [{ rowNumber: 1, values: ["B2401"], confidence: 0.9, warnings: [] }],
      summaryRows: [],
      warnings: [],
      unresolvedText: [],
    });

    expect(result.columns[0].id).toBe("batch_no");
  });

  it("rejects responses without an item table", () => {
    expect(() => validateInvoice({ columns: [], rows: [] })).toThrow("product-table header");
  });
});
