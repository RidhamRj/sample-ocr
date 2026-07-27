export type SummaryKind =
  | "subtotal"
  | "discount"
  | "cgst"
  | "sgst"
  | "igst"
  | "cess"
  | "freight"
  | "handling"
  | "round_off"
  | "taxable_amount"
  | "credit_adjustment"
  | "debit_adjustment"
  | "final_amount"
  | "other";

export type GstJurisdiction =
  | "intrastate"
  | "interstate"
  | "not_applicable"
  | "unknown";

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
  supplierName: string | null;
  invoiceNumber: string | null;
  billDate: string | null;
  gstJurisdiction: GstJurisdiction;
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

export type ValidationSeverity = "error" | "warning";

export interface InvoiceValidationIssue {
  severity: ValidationSeverity;
  scope: "document" | "column" | "row" | "summary";
  message: string;
  rowNumber?: number;
  columnId?: string;
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

export interface GeminiServiceStatus {
  status: "ok";
  service: string;
  models: string[];
  defaultModel?: string;
  serverKeyConfigured: boolean;
  allowsUserKey: boolean;
}