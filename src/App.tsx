import { useEffect, useMemo, useRef, useState } from "react";
import { exportGeminiWorkbook } from "./lib/exportGeminiWorkbook";
import { analyzeInvoice, getGeminiServiceStatus } from "./lib/geminiInvoiceClient";
import { normalizeInvoice, validateInvoice } from "./lib/invoiceValidation";
import { prepareInvoiceImage } from "./lib/prepareInvoiceImage";
import type {
  GeminiInvoiceJson,
  GeminiServiceStatus,
  GstJurisdiction,
  PreparedInvoiceImage,
  SummaryKind,
} from "./types/invoice";

const DEFAULT_MODEL = "gemini-3.5-flash";
const MODELS = [
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash — free-tier stable default" },
  { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite — quota-friendly fallback" },
  { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite — document extraction" },
  { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash — advanced multimodal" },
];

const SUMMARY_KINDS: SummaryKind[] = [
  "subtotal",
  "taxable_amount",
  "discount",
  "cgst",
  "sgst",
  "igst",
  "cess",
  "freight",
  "handling",
  "credit_adjustment",
  "debit_adjustment",
  "round_off",
  "other",
];

const GST_JURISDICTIONS: Array<{ value: GstJurisdiction; label: string }> = [
  { value: "intrastate", label: "Intrastate — CGST + SGST" },
  { value: "interstate", label: "Interstate — IGST" },
  { value: "not_applicable", label: "GST not applicable" },
  { value: "unknown", label: "Unknown — needs review" },
];

const DEMO_RESULT: GeminiInvoiceJson = {
  documentType: "Tax invoice",
  supplierName: "DEMO PHARMA DISTRIBUTORS",
  invoiceNumber: "INV/2026/0142",
  billDate: "27/07/2026",
  gstJurisdiction: "intrastate",
  tableTitle: "Medicine purchase items",
  currency: "INR",
  columns: [
    { id: "description", header: "PARTICULARS" },
    { id: "batch", header: "BATCH" },
    { id: "expiry", header: "EXP" },
    { id: "quantity", header: "QTY" },
    { id: "rate", header: "RATE" },
    { id: "amount", header: "AMOUNT" },
  ],
  rows: [
    { rowNumber: 1, values: ["DEMO TABLET", "DM2401", "08/28", "5", "82.50", "412.50"], confidence: 0.98, warnings: [] },
    { rowNumber: 2, values: ["DEMO SYRUP", "DS118", "11/27", "2", "125.00", "250.00"], confidence: 0.97, warnings: [] },
  ],
  summaryRows: [
    { label: "Taxable amount", amount: "662.50", kind: "taxable_amount" },
    { label: "CGST 6%", amount: "39.75", kind: "cgst" },
    { label: "SGST 6%", amount: "39.75", kind: "sgst" },
    { label: "Round off", amount: "0.00", kind: "round_off" },
  ],
  finalAmount: "742.00",
  unresolvedText: [],
  warnings: ["Demo data only — no invoice was sent to Gemini."],
  extractionConfidence: 0.98,
  model: "demo",
  processingTimeMs: 0,
};

const bytesLabel = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

export default function App() {
  const [serviceStatus, setServiceStatus] = useState<GeminiServiceStatus | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem("sample-ocr-gemini-key") ?? "");
  const [rememberKey, setRememberKey] = useState(() => Boolean(sessionStorage.getItem("sample-ocr-gemini-key")));
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [file, setFile] = useState<File | null>(null);
  const [prepared, setPrepared] = useState<PreparedInvoiceImage | null>(null);
  const [ocrEvidence, setOcrEvidence] = useState("");
  const [result, setResult] = useState<GeminiInvoiceJson | null>(null);
  const [status, setStatus] = useState("Checking the Gemini extraction service…");
  const [processing, setProcessing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"table" | "json" | "review">("table");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getGeminiServiceStatus(controller.signal)
      .then((nextStatus) => {
        setServiceStatus(nextStatus);
        setServiceError(null);
        setStatus(nextStatus.serverKeyConfigured
          ? "Server Gemini key detected. Choose an invoice image."
          : "Choose an invoice image and paste a free Gemini API key.");
      })
      .catch((caught) => {
        setServiceError(caught instanceof Error ? caught.message : String(caught));
        setStatus("The Gemini service could not be verified.");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => () => {
    if (prepared?.previewUrl) URL.revokeObjectURL(prepared.previewUrl);
  }, [prepared?.previewUrl]);

  const validationIssues = useMemo(() => result ? validateInvoice(result) : [], [result]);
  const errorCount = validationIssues.filter((issue) => issue.severity === "error").length;
  const warningCount = validationIssues.filter((issue) => issue.severity === "warning").length;
  const serverKeyConfigured = Boolean(serviceStatus?.serverKeyConfigured);
  const userKeyAllowed = serviceStatus?.allowsUserKey !== false;
  const keyReady = serverKeyConfigured || (userKeyAllowed && apiKey.trim().length >= 20);

  const chooseFile = async (next: File | null) => {
    if (prepared?.previewUrl) URL.revokeObjectURL(prepared.previewUrl);
    setFile(next);
    setPrepared(null);
    setResult(null);
    setError(null);
    if (!next) {
      setStatus(serverKeyConfigured ? "Choose an invoice image." : "Choose an invoice image and paste a Gemini API key.");
      return;
    }
    try {
      setStatus("Preparing a readable image within Vercel's request limit…");
      const image = await prepareInvoiceImage(next);
      setPrepared(image);
      setStatus("Ready for Gemini table extraction.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("Image preparation failed.");
    }
  };

  const runExtraction = async () => {
    if (!file || !prepared || processing) return;
    if (!keyReady) {
      setError(userKeyAllowed
        ? "Paste a valid Gemini API key first."
        : "No server Gemini key is configured and user-provided keys are disabled.");
      return;
    }

    if (!serverKeyConfigured && rememberKey) sessionStorage.setItem("sample-ocr-gemini-key", apiKey.trim());
    else if (!rememberKey) sessionStorage.removeItem("sample-ocr-gemini-key");

    const controller = new AbortController();
    abortRef.current = controller;
    setProcessing(true);
    setResult(null);
    setError(null);
    setStatus("Gemini is identifying supplier details, invoice identity, item rows, taxes, and the final amount…");
    try {
      const invoice = normalizeInvoice(await analyzeInvoice({
        apiKey: serverKeyConfigured ? undefined : apiKey,
        model,
        image: prepared,
        ocrEvidence,
        signal: controller.signal,
      }));
      setResult(invoice);
      setActiveTab("table");
      const fallbackNote = invoice.model !== model ? ` Automatic fallback used: ${invoice.model}.` : "";
      setStatus(`Extracted ${invoice.rows.length} rows and ${invoice.columns.length} columns in ${(invoice.processingTimeMs / 1000).toFixed(1)} seconds.${fallbackNote}`);
    } catch (caught) {
      if ((caught as DOMException)?.name !== "AbortError") {
        setError(caught instanceof Error ? caught.message : String(caught));
        setStatus("Gemini extraction failed.");
      }
    } finally {
      setProcessing(false);
      abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    setProcessing(false);
    setStatus("Request cancelled.");
  };

  const updateDocumentText = (field: "supplierName" | "invoiceNumber" | "billDate", value: string) => {
    setResult((current) => current ? normalizeInvoice({ ...current, [field]: value }) : current);
  };

  const updateGstJurisdiction = (value: GstJurisdiction) => {
    setResult((current) => current ? normalizeInvoice({ ...current, gstJurisdiction: value }) : current);
  };

  const updateColumnHeader = (columnIndex: number, value: string) => {
    setResult((current) => current ? normalizeInvoice({
      ...current,
      columns: current.columns.map((column, index) => index === columnIndex ? { ...column, header: value } : column),
    }) : current);
  };

  const updateCell = (rowIndex: number, columnIndex: number, value: string) => {
    setResult((current) => current ? normalizeInvoice({
      ...current,
      rows: current.rows.map((row, index) => index !== rowIndex ? row : {
        ...row,
        values: row.values.map((cell, cellIndex) => cellIndex === columnIndex ? value : cell),
      }),
    }) : current);
  };

  const addRow = () => {
    setResult((current) => current ? normalizeInvoice({
      ...current,
      rows: [
        ...current.rows,
        {
          rowNumber: current.rows.length + 1,
          values: Array.from({ length: current.columns.length }, () => null),
          confidence: null,
          warnings: ["Row added manually."],
        },
      ],
    }) : current);
  };

  const deleteRow = (rowIndex: number) => {
    setResult((current) => current ? normalizeInvoice({
      ...current,
      rows: current.rows
        .filter((_, index) => index !== rowIndex)
        .map((row, index) => ({ ...row, rowNumber: index + 1 })),
    }) : current);
  };

  const updateSummary = (index: number, field: "label" | "amount" | "kind", value: string) => {
    setResult((current) => current ? normalizeInvoice({
      ...current,
      summaryRows: current.summaryRows.map((row, rowIndex) => rowIndex !== index ? row : { ...row, [field]: value }),
    }) : current);
  };

  const addSummary = () => {
    setResult((current) => current ? normalizeInvoice({
      ...current,
      summaryRows: [...current.summaryRows, { label: "", amount: null, kind: "other" }],
    }) : current);
  };

  const deleteSummary = (index: number) => {
    setResult((current) => current ? normalizeInvoice({
      ...current,
      summaryRows: current.summaryRows.filter((_, rowIndex) => rowIndex !== index),
    }) : current);
  };

  const downloadExcel = async () => {
    if (!result || !file || exporting) return;
    setExporting(true);
    setError(null);
    try {
      await exportGeminiWorkbook(result, file.name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <span className="eyebrow">Gemini vision → strict JSON → editable Excel</span>
          <h1>Invoice table extractor</h1>
          <p>Gemini reads supplier and invoice identity, the printed table layout, every item row, GST jurisdiction, taxes, and final amount. The workbook is generated locally from the reviewed JSON.</p>
        </div>
        <div className="privacy-badge">No database · no GPU · key never committed</div>
      </header>

      {serviceError && <div className="error-banner">Service check: {serviceError}</div>}

      <section className="control-grid">
        <article className="panel setup-panel">
          <div className="panel-heading"><span className="step">1</span><div><h2>Gemini access</h2><p>Use a Google AI Studio key for this test app, or configure a server key on Vercel.</p></div></div>
          {serverKeyConfigured ? (
            <div className="server-key-note"><strong>Server key configured</strong><span>The browser does not need to receive or store the key.</span></div>
          ) : (
            <>
              <label className="field-label" htmlFor="api-key">Gemini API key</label>
              <input id="api-key" className="text-input" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="AIza…" autoComplete="off" disabled={!userKeyAllowed} />
              <label className="remember-row"><input type="checkbox" checked={rememberKey} onChange={(event) => setRememberKey(event.target.checked)} disabled={!userKeyAllowed} /> Remember only for this browser tab</label>
            </>
          )}
          <label className="field-label" htmlFor="model">Model</label>
          <select id="model" className="text-input" value={model} onChange={(event) => setModel(event.target.value)}>{MODELS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select>
          <small>Unavailable models automatically fall back to another supported model.</small>
        </article>

        <article className="panel upload-panel">
          <div className="panel-heading"><span className="step">2</span><div><h2>Invoice image</h2><p>Use a clear, straight photo. Small batch, expiry, and GST text need readable pixels.</p></div></div>
          <label className="drop-zone"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)} /><strong>{file?.name ?? "Choose JPG, PNG, or WebP"}</strong><span>{file ? bytesLabel(file.size) : "The browser compresses the request below the Vercel body limit."}</span></label>
          {prepared && <div className="image-meta"><img src={prepared.previewUrl} alt="Prepared invoice preview" /><div><strong>{prepared.processedWidth} × {prepared.processedHeight}</strong><span>{bytesLabel(prepared.processedBytes)} sent to Gemini</span>{prepared.warnings.map((warning) => <small key={warning}>{warning}</small>)}</div></div>}
        </article>
      </section>

      <section className="panel evidence-panel">
        <div className="panel-heading"><span className="step">3</span><div><h2>Optional OCR evidence</h2><p>Paste PharmaCare OCR text or text boxes here. Gemini uses it as evidence, not as unquestioned truth.</p></div></div>
        <textarea className="ocr-input" value={ocrEvidence} onChange={(event) => setOcrEvidence(event.target.value)} placeholder="Optional: paste flat OCR text or OCR boxes here…" />
      </section>

      <section className="run-bar">
        <div><strong>{status}</strong><span>Unreadable values must remain null rather than being guessed.</span></div>
        <div className="actions">
          <button className="ghost-button" onClick={() => { setResult(normalizeInvoice(DEMO_RESULT)); setFile(new File(["demo"], "demo-invoice.jpg", { type: "image/jpeg" })); setActiveTab("table"); setStatus("Loaded demo JSON to test editing and Excel download."); }}>Load demo</button>
          {processing && <button className="ghost-button" onClick={cancel}>Cancel</button>}
          <button className="primary-button" disabled={!prepared || !keyReady || processing} onClick={() => void runExtraction()}>{processing ? "Analysing invoice…" : "Extract table with Gemini"}</button>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}

      {result && <section className="results-shell">
        <div className="results-toolbar">
          <div className="stats">
            <span><strong>{result.columns.length}</strong> columns</span>
            <span><strong>{result.rows.length}</strong> rows</span>
            <span><strong>{result.summaryRows.length}</strong> totals/taxes</span>
            <span className={errorCount ? "error-stat" : "ok-stat"}><strong>{errorCount}</strong> blocking</span>
            <span className={warningCount ? "warning-stat" : "ok-stat"}><strong>{warningCount}</strong> warnings</span>
          </div>
          <div className="toolbar-actions"><div className="tabs"><button className={activeTab === "table" ? "active" : ""} onClick={() => setActiveTab("table")}>Table</button><button className={activeTab === "review" ? "active" : ""} onClick={() => setActiveTab("review")}>Review</button><button className={activeTab === "json" ? "active" : ""} onClick={() => setActiveTab("json")}>JSON</button></div><button className="primary-button" disabled={exporting} onClick={() => void downloadExcel()}>{exporting ? "Building Excel…" : errorCount ? "Download with warnings" : "Download Excel"}</button></div>
        </div>

        {activeTab === "table" && <div className="table-layout">
          {prepared && <aside className="source-preview"><h3>Source image</h3><img src={prepared.previewUrl} alt="Invoice source" /></aside>}
          <div className="table-card">
            <div className="invoice-meta-editor">
              <div className="summary-toolbar"><h3>Supplier and invoice details</h3><span>Edit these before downloading or integrating the JSON.</span></div>
              <div className="invoice-meta-grid">
                <label><span>Supplier name</span><input value={result.supplierName ?? ""} onChange={(event) => updateDocumentText("supplierName", event.target.value)} placeholder="Printed supplier/vendor name" /></label>
                <label><span>Invoice number</span><input value={result.invoiceNumber ?? ""} onChange={(event) => updateDocumentText("invoiceNumber", event.target.value)} placeholder="Printed invoice or bill number" /></label>
                <label><span>Bill date</span><input value={result.billDate ?? ""} onChange={(event) => updateDocumentText("billDate", event.target.value)} placeholder="Preserve printed date format" /></label>
                <label><span>GST jurisdiction</span><select value={result.gstJurisdiction} onChange={(event) => updateGstJurisdiction(event.target.value as GstJurisdiction)}>{GST_JURISDICTIONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label>
              </div>
            </div>
            <div className="table-actions"><button className="ghost-button" onClick={addRow}>Add missing row</button><span>Edit headings and cells before downloading.</span></div>
            <div className="table-scroll"><table><thead><tr><th className="row-index">#</th>{result.columns.map((column, columnIndex) => <th key={column.id}><input className="column-header-input" value={column.header} onChange={(event) => updateColumnHeader(columnIndex, event.target.value)} aria-label={`Column ${columnIndex + 1} heading`} /></th>)}<th className="row-action-header">Action</th></tr></thead><tbody>{result.rows.map((row, rowIndex) => <tr key={`${row.rowNumber}-${rowIndex}`}><td className="row-index">{row.rowNumber}</td>{result.columns.map((column, columnIndex) => <td key={column.id}><textarea value={row.values[columnIndex] ?? ""} onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)} aria-label={`Row ${row.rowNumber} ${column.header}`} /></td>)}<td className="row-action-cell"><button className="danger-button" onClick={() => deleteRow(rowIndex)} aria-label={`Delete row ${row.rowNumber}`}>Delete</button></td></tr>)}</tbody></table></div>
            <div className="summary-editor">
              <div className="summary-toolbar"><h3>Taxes, totals, and adjustments</h3><button className="ghost-button" onClick={addSummary}>Add summary line</button></div>
              {result.summaryRows.map((summary, index) => <div className="summary-line" key={`${summary.kind}-${index}`}><select value={summary.kind} onChange={(event) => updateSummary(index, "kind", event.target.value)}>{SUMMARY_KINDS.map((kind) => <option key={kind} value={kind}>{kind.replaceAll("_", " ")}</option>)}</select><input value={summary.label} onChange={(event) => updateSummary(index, "label", event.target.value)} placeholder="Printed label" /><input value={summary.amount ?? ""} onChange={(event) => updateSummary(index, "amount", event.target.value)} placeholder="Amount" /><button className="danger-button" onClick={() => deleteSummary(index)}>Delete</button></div>)}
              <div className="summary-line final-line"><strong>Final amount</strong><span /><input value={result.finalAmount ?? ""} onChange={(event) => setResult((current) => current ? normalizeInvoice({ ...current, finalAmount: event.target.value }) : current)} /><span /></div>
            </div>
          </div>
        </div>}

        {activeTab === "review" && <div className="review-grid">
          <article className="full-width"><h3>Deterministic validation</h3>{validationIssues.length ? validationIssues.map((issue, index) => <p className={issue.severity === "error" ? "issue-error" : "issue-warning"} key={`${issue.scope}-${issue.rowNumber ?? "x"}-${index}`}><strong>{issue.severity.toUpperCase()} · {issue.scope}{issue.rowNumber ? ` · row ${issue.rowNumber}` : ""}</strong><br />{issue.message}</p>) : <p className="muted">No deterministic issues found. Visual comparison with the invoice is still required.</p>}</article>
          <article><h3>Model warnings</h3>{result.warnings.length ? result.warnings.map((warning) => <p key={warning}>{warning}</p>) : <p className="muted">No model warnings.</p>}</article>
          <article><h3>Unresolved text</h3>{result.unresolvedText.length ? result.unresolvedText.map((text) => <p key={text}>{text}</p>) : <p className="muted">No unresolved text.</p>}</article>
        </div>}
        {activeTab === "json" && <pre className="json-view">{JSON.stringify(result, null, 2)}</pre>}
      </section>}

      <footer><strong>Important:</strong> This is an extraction assistant. Verify supplier, invoice number, bill date, GST jurisdiction, batch, expiry, quantity, rate, taxes, and final amount before importing anything into pharmacy inventory. Free-tier invoice content may be processed under Google's free-tier data terms.</footer>
    </main>
  );
}