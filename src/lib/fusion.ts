import type { BrowserGeometryResult, CanonicalCell, CanonicalDocument, CanonicalTable, GeometryCell, OcrBox, Point, Rectangle } from "../types/canonical";

const EPSILON = 1e-6;
export function transformPoint(point: Point, matrix: number[]): Point { if (matrix.length !== 9) return point; const [x, y] = point; const d = matrix[6] * x + matrix[7] * y + matrix[8]; if (Math.abs(d) < EPSILON) return point; return [(matrix[0] * x + matrix[1] * y + matrix[2]) / d, (matrix[3] * x + matrix[4] * y + matrix[5]) / d]; }
export function boundsFromPoints(points: Point[]): Rectangle { const xs = points.map(([x]) => x); const ys = points.map(([, y]) => y); const x = Math.min(...xs), y = Math.min(...ys); return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }; }
const intersectionArea = (a: Rectangle, b: Rectangle) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const centreInside = (inner: Rectangle, outer: Rectangle) => { const x = inner.x + inner.width / 2, y = inner.y + inner.height / 2; return x >= outer.x && x <= outer.x + outer.width && y >= outer.y && y <= outer.y + outer.height; };
const median = (values: number[]) => { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
const cluster1d = (values: number[], tolerance: number) => { const clusters: number[][] = []; for (const value of [...values].sort((a, b) => a - b)) { const last = clusters.at(-1); if (!last || value - last.at(-1)! > tolerance) clusters.push([value]); else last.push(value); } return clusters.map((cluster) => cluster.reduce((sum, value) => sum + value, 0) / cluster.length); };
const transformedOcr = (ocr: OcrBox[], geometry: BrowserGeometryResult) => ocr.map((item) => ({ ...item, box: item.box.map((point) => transformPoint(point, geometry.page_transform.forward)) }));
interface Assignment { cellId: string; ocr: OcrBox; score: number; }
function assignOcrToCells(ocr: OcrBox[], cells: GeometryCell[]) {
  const assignments: Assignment[] = [], unassigned: OcrBox[] = [];
  for (const item of ocr) {
    const bounds = boundsFromPoints(item.box), area = Math.max(bounds.width * bounds.height, 1);
    const candidates = cells.map((cell) => { const overlap = intersectionArea(bounds, cell) / area; return { cell, overlap, score: overlap + (centreInside(bounds, cell) ? 0.12 : 0) }; }).filter((candidate) => candidate.overlap >= 0.12 || candidate.score >= 0.12).sort((a, b) => b.score - a.score);
    const crossedColumns = new Set(candidates.filter((candidate) => candidate.overlap >= 0.18).map((candidate) => `${candidate.cell.tableId}:${candidate.cell.column}`)).size; const best = candidates[0];
    if (!best || best.score < 0.34 || (crossedColumns > 1 && best.overlap < 0.68)) unassigned.push(item); else assignments.push({ cellId: best.cell.id, ocr: item, score: Math.min(1, best.score) });
  }
  return { assignments, unassigned };
}
function materializeTable(tableId: string, cells: GeometryCell[], assignments: Assignment[], source: CanonicalTable["source"]): CanonicalTable {
  const byCell = new Map<string, Assignment[]>(); for (const assignment of assignments) byCell.set(assignment.cellId, [...(byCell.get(assignment.cellId) ?? []), assignment]);
  const canonicalCells: CanonicalCell[] = cells.map((cell) => { const assigned = (byCell.get(cell.id) ?? []).sort((a, b) => a.ocr.readingOrder - b.ocr.readingOrder); const confidence = assigned.length ? assigned.reduce((sum, a) => sum + a.ocr.confidence, 0) / assigned.length : null; return { ...cell, text: assigned.map((a) => a.ocr.text).join("\n"), sourceOcrIds: assigned.map((a) => a.ocr.id), confidence, warning: confidence !== null && confidence < 0.65 ? "Low OCR confidence" : null, manuallyEdited: false }; });
  return { id: tableId, pageNumber: 1, title: source === "ruled-grid" ? "Detected table" : "Borderless table", rows: Math.max(0, ...cells.map((cell) => cell.row + cell.rowSpan)), columns: Math.max(0, ...cells.map((cell) => cell.column + cell.columnSpan)), cells: canonicalCells, source, confidence: source === "ruled-grid" ? 0.82 : 0.58 };
}
function borderlessCells(ocr: OcrBox[], pageWidth: number, pageHeight: number): GeometryCell[] {
  if (ocr.length < 9) return []; const boxes = ocr.map((item) => boundsFromPoints(item.box)); const rowCenters = cluster1d(boxes.map((b) => b.y + b.height / 2), Math.max(8, median(boxes.map((b) => b.height)) * 0.75)); if (rowCenters.length < 3) return [];
  const columnCenters = cluster1d(boxes.map((b) => b.x + b.width / 2), Math.max(18, Math.max(20, median(boxes.map((b) => b.width))) * 0.7)); if (columnCenters.length < 3 || columnCenters.length > 18) return [];
  const rows = [0, ...rowCenters.slice(1).map((v, i) => (rowCenters[i] + v) / 2), pageHeight], columns = [0, ...columnCenters.slice(1).map((v, i) => (columnCenters[i] + v) / 2), pageWidth], cells: GeometryCell[] = [];
  for (let row = 0; row < rows.length - 1; row++) for (let column = 0; column < columns.length - 1; column++) cells.push({ id: `borderless-1-r${row}-c${column}`, tableId: "borderless-1", row, column, rowSpan: 1, columnSpan: 1, x: columns[column], y: rows[row], width: columns[column + 1] - columns[column], height: rows[row + 1] - rows[row] });
  return cells;
}
export function buildCanonicalDocument(args: { fileName: string; originalBytes: number; processedBytes: number; originalWidth: number; originalHeight: number; processedWidth: number; processedHeight: number; mimeType: string; geometry: BrowserGeometryResult; ocr: OcrBox[]; ocrDiagnostics: Record<string, unknown>; }): CanonicalDocument {
  const aligned = transformedOcr(args.ocr, args.geometry), ruled = args.geometry.cell_rectangles; let tables: CanonicalTable[] = [], unassigned = aligned;
  if (ruled.length) { const grouped = new Map<string, GeometryCell[]>(); for (const cell of ruled) grouped.set(cell.tableId, [...(grouped.get(cell.tableId) ?? []), cell]); const result = assignOcrToCells(aligned, ruled); unassigned = result.unassigned; tables = [...grouped.entries()].map(([id, cells]) => materializeTable(id, cells, result.assignments.filter((a) => cells.some((cell) => cell.id === a.cellId)), "ruled-grid")); }
  if (!tables.length) { const cells = borderlessCells(aligned, args.geometry.page_transform.targetWidth, args.geometry.page_transform.targetHeight); if (cells.length) { const result = assignOcrToCells(aligned, cells); unassigned = result.unassigned; tables = [materializeTable("borderless-1", cells, result.assignments, "borderless-ocr")]; } }
  return { schemaVersion: "1.0", source: { fileName: args.fileName, originalBytes: args.originalBytes, processedBytes: args.processedBytes, originalWidth: args.originalWidth, originalHeight: args.originalHeight, processedWidth: args.processedWidth, processedHeight: args.processedHeight, mimeType: args.mimeType }, pages: [{ pageNumber: 1, width: args.processedWidth, height: args.processedHeight }], tables, rawOcr: args.ocr, unassignedOcr: unassigned, diagnostics: { geometry: args.geometry.diagnostics, ocr: args.ocrDiagnostics, ruledCellCount: ruled.length, tableCount: tables.length, assignedOcrCount: aligned.length - unassigned.length, unassignedOcrCount: unassigned.length } };
}
