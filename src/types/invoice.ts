export type SummaryKind =
  | "subtotal"
  | "discount"
  | "cgst"
  | "sgst"
  | "igst"
  | "cess"
  | "freight"
  | "round_off"
  | "taxable_amount"
  | "final_amount"
  | "other";

export interface InvoiceColumn {
  id: string;
  header: string;
}

export interface InvoiceRow {
  rowNumber: number;
  values: Array<string | null>;
  confidence: number | null;
  warnings: string[];
}

export interface InvoiceSummaryRow {
  label: string;
  amount: string | null;
  kind: SummaryKind;
}

export interface GeminiInvoiceJson {
  documentType: string;
  tableTitle: string | null;
  currency: string | null;
  columns: InvoiceColumn[];
  rows: InvoiceRow[];
  summaryRows: InvoiceSummaryRow[];
  finalAmount: string | null;
  unresolvedText: string[];
  warnings: string[];
  extractionConfidence: number | null;
  model: string;
  processingTimeMs: number;
}

export interface PreparedInvoiceImage {
  base64: string;
  mimeType: "image/jpeg";
  previewUrl: string;
  originalBytes: number;
  processedBytes: number;
  originalWidth: number;
  originalHeight: number;
  processedWidth: number;
  processedHeight: number;
  warnings: string[];
}
