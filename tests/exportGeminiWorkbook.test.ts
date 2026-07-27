import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildGeminiWorkbookBuffer } from "../src/lib/exportGeminiWorkbook";
import type { GeminiInvoiceJson } from "../src/types/invoice";

const invoice: GeminiInvoiceJson = {
  documentType: "Tax Invoice",
  supplierName: "ABC Pharma Agencies",
  invoiceNumber: "INV/0042",
  billDate: "27/07/2026",
  gstJurisdiction: "intrastate",
  tableTitle: "Purchase Items",
  currency: "INR",
  columns: [
    { id: "description", header: "PARTICULARS" },
    { id: "batch", header: "BATCH" },
    { id: "quantity", header: "QTY" },
    { id: "amount", header: "AMOUNT" },
  ],
  rows: [
    { rowNumber: 1, values: ["Medicine A", "A01", "2", "100.00"], confidence: 0.95, warnings: [] },
    { rowNumber: 2, values: ["Medicine B", null, "1", "50.00"], confidence: 0.62, warnings: ["Batch was unreadable."] },
  ],
  summaryRows: [
    { label: "Taxable Amount", amount: "150.00", kind: "taxable_amount" },
    { label: "CGST 6%", amount: "9.00", kind: "cgst" },
    { label: "SGST 6%", amount: "9.00", kind: "sgst" },
  ],
  finalAmount: "168.00",
  unresolvedText: ["Unreadable footer stamp"],
  warnings: [],
  extractionConfidence: 0.82,
  model: "gemini-3.5-flash",
  processingTimeMs: 900,
};

describe("Gemini workbook export", () => {
  it("preserves invoice metadata, dynamic rows, taxes, JSON, and validation", async () => {
    const buffer = await buildGeminiWorkbookBuffer(invoice);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Invoice Table",
      "Gemini JSON",
      "Validation",
    ]);

    const table = workbook.getWorksheet("Invoice Table");
    expect(table?.getCell("A1").value).toBe("Purchase Items");
    expect(table?.getCell("A2").value).toBe("SUPPLIER NAME");
    expect(table?.getCell("B2").value).toBe("ABC Pharma Agencies");
    expect(table?.getCell("B3").value).toBe("INV/0042");
    expect(table?.getCell("B4").value).toBe("27/07/2026");
    expect(table?.getCell("B5").value).toBe("INTRASTATE");
    expect(table?.getCell("A7").value).toBe("PARTICULARS");
    expect(table?.getCell("B9").value).toBe("");
    expect(table?.getCell("D9").value).toBe("50.00");
    expect(table?.getCell("A11").value).toBe("Taxable Amount");
    expect(table?.getCell("D14").value).toBe("168.00");

    const json = workbook.getWorksheet("Gemini JSON");
    const jsonText = json?.getColumn(1).values.map(String).join("\n") ?? "";
    expect(jsonText).toContain('"supplierName": "ABC Pharma Agencies"');
    expect(jsonText).toContain('"gstJurisdiction": "intrastate"');

    const validation = workbook.getWorksheet("Validation");
    const validationText = validation?.getColumn(5).values.map(String).join("\n") ?? "";
    expect(validationText).toContain("Row 2 confidence is 62%.");
    expect(validationText).toContain("Batch was unreadable.");
    expect(validationText).toContain("Unresolved: Unreadable footer stamp");
  });
});