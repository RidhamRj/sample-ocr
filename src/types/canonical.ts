export type Point = [number, number];

export interface Rectangle { x: number; y: number; width: number; height: number; }
export interface OcrBox { id: string; pageNumber: number; text: string; confidence: number; box: Point[]; readingOrder: number; kind: "word" | "line"; }
export interface GeometryLine { x1: number; y1: number; x2: number; y2: number; strength?: number; }
export interface GeometryCell extends Rectangle { id: string; tableId: string; row: number; column: number; rowSpan: number; columnSpan: number; }
export interface PageTransform { sourceWidth: number; sourceHeight: number; targetWidth: number; targetHeight: number; forward: number[]; inverse: number[]; perspectiveApplied: boolean; deskewDegrees: number; }
export interface BrowserGeometryResult { page_transform: PageTransform; table_candidates: Array<Rectangle & { id: string; confidence: number }>; horizontal_lines: GeometryLine[]; vertical_lines: GeometryLine[]; row_boundaries: number[]; column_boundaries: number[]; cell_rectangles: GeometryCell[]; diagnostics: Record<string, unknown>; }
export interface CanonicalCell extends GeometryCell { text: string; sourceOcrIds: string[]; confidence: number | null; warning: string | null; manuallyEdited: boolean; }
export interface CanonicalTable { id: string; pageNumber: number; title: string; rows: number; columns: number; cells: CanonicalCell[]; source: "ruled-grid" | "borderless-ocr"; confidence: number; }
export interface CanonicalDocument { schemaVersion: "1.0"; source: { fileName: string; originalBytes: number; processedBytes: number; originalWidth: number; originalHeight: number; processedWidth: number; processedHeight: number; mimeType: string; }; pages: Array<{ pageNumber: number; width: number; height: number }>; tables: CanonicalTable[]; rawOcr: OcrBox[]; unassignedOcr: OcrBox[]; diagnostics: Record<string, unknown>; }
