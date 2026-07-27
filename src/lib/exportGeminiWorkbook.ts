import ExcelJS from "exceljs";
import { validateInvoice } from "./invoiceValidation";
import type { GeminiInvoiceJson, InvoiceValidationIssue } from "../types/invoice";

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

function styleHeader(cell: ExcelJS.Cell): void {
  cell.font = { bold: true, color: { argb: "FF17326D" } };
  cell.alignment = { vertical: "middle", wrapText: true };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDE7FF" } };
  cell.border = {
    top: { style: "thin", color: { argb: "FFB8C7E8" } },
    left: { style: "thin", color: { argb: "FFB8C7E8" } },
    bottom: { style: "thin", color: { argb: "FFB8C7E8" } },
    right: { style: "thin", color: { argb: "FFB8C7E8" } },
  };
}

function addMetadataRow(
  sheet: ExcelJS.Worksheet,
  rowNumber: number,
  columnCount: number,
  label: string,
  value: string | null,
): void {
  const labelCell = sheet.getCell(rowNumber, 1);
  labelCell.value = label;
  labelCell.font = { bold: true, color: { argb: "FF46536B" } };
  labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F6FB" } };
  labelCell.alignment = { vertical: "middle" };

  if (columnCount === 1) {
    labelCell.value = `${label}: ${value ?? ""}`;
    return;
  }

  if (columnCount > 2) sheet.mergeCells(rowNumber, 2, rowNumber, columnCount);
  const valueCell = sheet.getCell(rowNumber, 2);
  valueCell.value = value ?? "";
  valueCell.alignment = { vertical: "middle", wrapText: true };
}

function addValidationSheet(workbook: ExcelJS.Workbook, issues: InvoiceValidationIssue[]): void {
  const sheet = workbook.addWorksheet("Validation");
  sheet.columns = [
    { header: "Severity", key: "severity", width: 12 },
    { header: "Scope", key: "scope", width: 14 },
    { header: "Row", key: "row", width: 10 },
    { header: "Column", key: "column", width: 24 },
    { header: "Message", key: "message", width: 100 },
  ];
  sheet.getRow(1).eachCell(styleHeader);

  if (issues.length === 0) {
    sheet.addRow({ severity: "OK", scope: "document", row: "", column: "", message: "No deterministic validation issues were found. Visual review is still required." });
  } else {
    issues.forEach((issue) => {
      sheet.addRow({
        severity: issue.severity.toUpperCase(),
        scope: issue.scope,
        row: issue.rowNumber ?? "",
        column: issue.columnId ?? "",
        message: issue.message,
      });
    });
  }

  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = "A1:E1";
}

export function buildGeminiWorkbook(invoice: GeminiInvoiceJson): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Sample OCR Gemini Invoice Extractor";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.subject = "Human-reviewed pharmacy supplier invoice extraction";

  const tableHeaderRow = 7;
  const dataStartRow = tableHeaderRow + 1;
  const sheet = workbook.addWorksheet("Invoice Table", {
    views: [{ state: "frozen", ySplit: tableHeaderRow }],
  });

  const columnCount = Math.max(1, invoice.columns.length);
  sheet.mergeCells(1, 1, 1, columnCount);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = invoice.tableTitle || invoice.documentType || "Extracted invoice table";
  titleCell.font = { bold: true, size: 15, color: { argb: "FF172B68" } };
  titleCell.alignment = { vertical: "middle" };
  sheet.getRow(1).height = 26;

  addMetadataRow(sheet, 2, columnCount, "SUPPLIER NAME", invoice.supplierName);
  addMetadataRow(sheet, 3, columnCount, "INVOICE NUMBER", invoice.invoiceNumber);
  addMetadataRow(sheet, 4, columnCount, "BILL DATE", invoice.billDate);
  addMetadataRow(sheet, 5, columnCount, "GST JURISDICTION", invoice.gstJurisdiction.replaceAll("_", " ").toUpperCase());

  invoice.columns.forEach((column, index) => {
    const cell = sheet.getCell(tableHeaderRow, index + 1);
    cell.value = column.header;
    styleHeader(cell);
  });

  invoice.rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(dataStartRow + rowIndex);
    for (let columnIndex = 0; columnIndex < invoice.columns.length; columnIndex += 1) {
      const cell = excelRow.getCell(columnIndex + 1);
      cell.value = row.values[columnIndex] ?? "";
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = {
        top: { style: "hair", color: { argb: "FFD4DBE8" } },
        left: { style: "hair", color: { argb: "FFD4DBE8" } },
        bottom: { style: "hair", color: { argb: "FFD4DBE8" } },
        right: { style: "hair", color: { argb: "FFD4DBE8" } },
      };
      if (row.warnings.length || (row.confidence !== null && row.confidence < 0.7)) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF4CC" } };
      }
    }
  });

  const tableEndRow = dataStartRow + invoice.rows.length - 1;
  if (invoice.columns.length > 0 && tableEndRow >= tableHeaderRow) {
    sheet.autoFilter = {
      from: { row: tableHeaderRow, column: 1 },
      to: { row: tableEndRow, column: invoice.columns.length },
    };
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
  sheet.getCell(finalRowNumber, amountColumn).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7F7EC" } };
  sheet.getRow(finalRowNumber).height = 23;

  invoice.columns.forEach((column, index) => {
    const values = invoice.rows.map((row) => row.values[index] ?? "");
    const longest = Math.max(column.header.length, ...values.map((value) => String(value).length));
    sheet.getColumn(index + 1).width = Math.min(42, Math.max(12, longest + 2));
  });

  const jsonSheet = workbook.addWorksheet("Gemini JSON");
  jsonSheet.getColumn(1).width = 120;
  JSON.stringify(invoice, null, 2).split("\n").forEach((line) => jsonSheet.addRow([line]));

  addValidationSheet(workbook, validateInvoice(invoice));
  return workbook;
}

export async function buildGeminiWorkbookBuffer(invoice: GeminiInvoiceJson): Promise<ArrayBuffer> {
  const workbook = buildGeminiWorkbook(invoice);
  return workbook.xlsx.writeBuffer();
}

export async function exportGeminiWorkbook(invoice: GeminiInvoiceJson, sourceName: string): Promise<void> {
  const output = await buildGeminiWorkbookBuffer(invoice);
  downloadBlob(
    new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${safeFileName(sourceName.replace(/\.[^.]+$/, ""))}-gemini.xlsx`,
  );
}