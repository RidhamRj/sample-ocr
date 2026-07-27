import ExcelJS from "exceljs";
import type { GeminiInvoiceJson } from "../types/invoice";

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "invoice";
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportGeminiWorkbook(invoice: GeminiInvoiceJson, sourceName: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Sample OCR Gemini Invoice Extractor";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Invoice Table", {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  const columnCount = Math.max(1, invoice.columns.length);
  sheet.mergeCells(1, 1, 1, columnCount);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = invoice.tableTitle || "Extracted invoice table";
  titleCell.font = { bold: true, size: 15 };
  titleCell.alignment = { vertical: "middle" };
  sheet.getRow(1).height = 26;

  invoice.columns.forEach((column, index) => {
    const cell = sheet.getCell(2, index + 1);
    cell.value = column.header;
    cell.font = { bold: true };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDE7FF" } };
    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
  });

  invoice.rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(rowIndex + 3);
    for (let columnIndex = 0; columnIndex < invoice.columns.length; columnIndex += 1) {
      const cell = excelRow.getCell(columnIndex + 1);
      cell.value = row.values[columnIndex] ?? "";
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = {
        top: { style: "hair" },
        left: { style: "hair" },
        bottom: { style: "hair" },
        right: { style: "hair" },
      };
    }
  });

  const tableEndRow = invoice.rows.length + 2;
  if (invoice.columns.length > 0 && tableEndRow >= 2) {
    sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: tableEndRow, column: invoice.columns.length } };
  }

  const summaryStart = tableEndRow + 2;
  const labelColumn = Math.max(1, invoice.columns.length - 1);
  const amountColumn = Math.max(1, invoice.columns.length);

  invoice.summaryRows.forEach((summary, index) => {
    const rowNumber = summaryStart + index;
    if (labelColumn > 1) sheet.mergeCells(rowNumber, 1, rowNumber, labelColumn);
    const label = sheet.getCell(rowNumber, 1);
    label.value = summary.label;
    label.alignment = { horizontal: "right" };
    const amount = sheet.getCell(rowNumber, amountColumn);
    amount.value = summary.amount ?? "";
    if (["cgst", "sgst", "igst", "cess"].includes(summary.kind)) {
      label.font = { italic: true };
      amount.font = { italic: true };
    }
  });

  const finalRowNumber = summaryStart + invoice.summaryRows.length;
  if (labelColumn > 1) sheet.mergeCells(finalRowNumber, 1, finalRowNumber, labelColumn);
  sheet.getCell(finalRowNumber, 1).value = "FINAL AMOUNT";
  sheet.getCell(finalRowNumber, 1).font = { bold: true, size: 12 };
  sheet.getCell(finalRowNumber, 1).alignment = { horizontal: "right" };
  sheet.getCell(finalRowNumber, amountColumn).value = invoice.finalAmount ?? "";
  sheet.getCell(finalRowNumber, amountColumn).font = { bold: true, size: 12 };
  sheet.getRow(finalRowNumber).height = 23;

  invoice.columns.forEach((column, index) => {
    const values = invoice.rows.map((row) => row.values[index] ?? "");
    const longest = Math.max(column.header.length, ...values.map((value) => String(value).length));
    sheet.getColumn(index + 1).width = Math.min(42, Math.max(12, longest + 2));
  });

  const jsonSheet = workbook.addWorksheet("Gemini JSON");
  jsonSheet.getColumn(1).width = 120;
  JSON.stringify(invoice, null, 2).split("\n").forEach((line) => jsonSheet.addRow([line]));

  const reviewSheet = workbook.addWorksheet("Review");
  reviewSheet.columns = [
    { header: "Type", key: "type", width: 18 },
    { header: "Message", key: "message", width: 100 },
  ];
  invoice.warnings.forEach((message) => reviewSheet.addRow({ type: "Model warning", message }));
  invoice.unresolvedText.forEach((message) => reviewSheet.addRow({ type: "Unresolved text", message }));
  invoice.rows.forEach((row) => row.warnings.forEach((message) => reviewSheet.addRow({ type: `Row ${row.rowNumber}`, message })));
  if (invoice.finalAmount === null) reviewSheet.addRow({ type: "Blocking", message: "Final amount was not extracted." });

  const output = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${safeFileName(sourceName.replace(/\.[^.]+$/, ""))}-gemini.xlsx`,
  );
}
