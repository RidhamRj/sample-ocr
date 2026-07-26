import type { CanonicalDocument } from "../types/canonical";

const safeSheetName = (name: string, fallback: string) => name.replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 31) || fallback;
const ocrColumns = () => [{ header: "Page", key: "page", width: 10 }, { header: "Order", key: "order", width: 10 }, { header: "Text", key: "text", width: 45 }, { header: "Confidence", key: "confidence", width: 14 }, { header: "Bounding box", key: "box", width: 48 }];

export async function buildCanonicalWorkbookBuffer(canonical: CanonicalDocument): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default; const workbook = new ExcelJS.Workbook(); workbook.creator = "sample-ocr"; workbook.created = new Date();
  const used = new Set<string>();
  canonical.tables.forEach((table, index) => {
    const base = safeSheetName(table.title, `Table ${index + 1}`); let name = base, suffix = 2;
    while (used.has(name.toLowerCase())) { const text = ` ${suffix++}`; name = `${base.slice(0, 31 - text.length)}${text}`; }
    used.add(name.toLowerCase()); const sheet = workbook.addWorksheet(name);
    for (let row = 1; row <= table.rows; row++) sheet.getRow(row).height = 24;
    for (let column = 1; column <= table.columns; column++) sheet.getColumn(column).width = 18;
    const occupied = new Set<string>();
    for (const cell of table.cells) {
      const row = cell.row + 1, column = cell.column + 1, target = sheet.getCell(row, column); target.value = cell.text; target.alignment = { vertical: "top", wrapText: true };
      target.border = { top: { style: "thin", color: { argb: "FFD6DBE5" } }, left: { style: "thin", color: { argb: "FFD6DBE5" } }, bottom: { style: "thin", color: { argb: "FFD6DBE5" } }, right: { style: "thin", color: { argb: "FFD6DBE5" } } };
      if (cell.warning) { target.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE8A3" } }; target.note = cell.warning; }
      if (cell.rowSpan > 1 || cell.columnSpan > 1) sheet.mergeCells(row, column, row + cell.rowSpan - 1, column + cell.columnSpan - 1);
      for (let r = cell.row; r < cell.row + cell.rowSpan; r++) for (let c = cell.column; c < cell.column + cell.columnSpan; c++) occupied.add(`${r}:${c}`);
    }
    for (let row = 0; row < table.rows; row++) for (let column = 0; column < table.columns; column++) if (!occupied.has(`${row}:${column}`)) sheet.getCell(row + 1, column + 1).value = "";
  });
  const raw = workbook.addWorksheet("Raw OCR"); raw.columns = ocrColumns(); canonical.rawOcr.forEach((item) => raw.addRow({ page: item.pageNumber, order: item.readingOrder, text: item.text, confidence: item.confidence, box: JSON.stringify(item.box) }));
  const unassigned = workbook.addWorksheet("Unassigned OCR"); unassigned.columns = ocrColumns(); canonical.unassignedOcr.forEach((item) => unassigned.addRow({ page: item.pageNumber, order: item.readingOrder, text: item.text, confidence: item.confidence, box: JSON.stringify(item.box) }));
  const diagnostics = workbook.addWorksheet("Diagnostics"); diagnostics.columns = [{ header: "Key", key: "key", width: 36 }, { header: "Value", key: "value", width: 80 }]; Object.entries(canonical.diagnostics).forEach(([key, value]) => diagnostics.addRow({ key, value: typeof value === "string" ? value : JSON.stringify(value) }));
  const buffer = await workbook.xlsx.writeBuffer(); return buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

export async function exportCanonicalWorkbook(canonical: CanonicalDocument): Promise<void> {
  const buffer = await buildCanonicalWorkbookBuffer(canonical); const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); const url = URL.createObjectURL(blob);
  try { const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${canonical.source.fileName.replace(/\.[^.]+$/, "") || "reconstructed"}.xlsx`; anchor.click(); } finally { URL.revokeObjectURL(url); }
}
