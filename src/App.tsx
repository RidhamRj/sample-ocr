import { useEffect, useMemo, useRef, useState } from "react";
import { exportGeminiWorkbook } from "./lib/exportGeminiWorkbook";
import { analyzeInvoice } from "./lib/geminiInvoiceClient";
import { prepareInvoiceImage } from "./lib/prepareInvoiceImage";
import type { GeminiInvoiceJson, PreparedInvoiceImage } from "./types/invoice";

const MODELS = [
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash — stable default" },
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash — newer model" },
  { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite — quota-friendly" },
];

const DEMO_RESULT: GeminiInvoiceJson = {
  documentType: "Tax invoice",
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

function normalizeResult(result: GeminiInvoiceJson): GeminiInvoiceJson {
  const columnCount = result.columns.length;
  return {
    ...result,
    rows: result.rows.map((row, index) => ({
      ...row,
      rowNumber: row.rowNumber || index + 1,
      values: Array.from({ length: columnCount }, (_, columnIndex) => row.values[columnIndex] ?? null),
      warnings: Array.isArray(row.warnings) ? row.warnings : [],
    })),
    summaryRows: Array.isArray(result.summaryRows) ? result.summaryRows : [],
    unresolvedText: Array.isArray(result.unresolvedText) ? result.unresolvedText : [],
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
  };
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem("sample-ocr-gemini-key") ?? "");
  const [rememberKey, setRememberKey] = useState(() => Boolean(sessionStorage.getItem("sample-ocr-gemini-key")));
  const [model, setModel] = useState("gemini-2.5-flash");
  const [file, setFile] = useState<File | null>(null);
  const [prepared, setPrepared] = useState<PreparedInvoiceImage | null>(null);
  const [ocrEvidence, setOcrEvidence] = useState("");
  const [result, setResult] = useState<GeminiInvoiceJson | null>(null);
  const [status, setStatus] = useState("Choose an invoice image and enter a Gemini API key.");
  const [processing, setProcessing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"table" | "json" | "review">("table");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => () => { if (prepared?.previewUrl) URL.revokeObjectURL(prepared.previewUrl); }, [prepared?.previewUrl]);

  const reviewCount = useMemo(() => {
    if (!result) return 0;
    return result.warnings.length + result.unresolvedText.length + result.rows.reduce((sum, row) => sum + row.warnings.length, 0) + (result.finalAmount ? 0 : 1);
  }, [result]);

  const chooseFile = async (next: File | null) => {
    if (prepared?.previewUrl) URL.revokeObjectURL(prepared.previewUrl);
    setFile(next);
    setPrepared(null);
    setResult(null);
    setError(null);
    if (!next) {
      setStatus("Choose an invoice image and enter a Gemini API key.");
      return;
    }
    try {
      setStatus("Preparing a readable image within Vercel's upload limit…");
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
    if (!apiKey.trim()) {
      setError("Paste your Gemini API key first.");
      return;
    }
    if (rememberKey) sessionStorage.setItem("sample-ocr-gemini-key", apiKey.trim());
    else sessionStorage.removeItem("sample-ocr-gemini-key");

    const controller = new AbortController();
    abortRef.current = controller;
    setProcessing(true);
    setResult(null);
    setError(null);
    setStatus("Gemini is identifying printed columns, product rows, taxes, and the final amount…");
    try {
      const invoice = normalizeResult(await analyzeInvoice({ apiKey, model, image: prepared, ocrEvidence, signal: controller.signal }));
      setResult(invoice);
      setActiveTab("table");
      setStatus(`Extracted ${invoice.rows.length} rows and ${invoice.columns.length} columns in ${(invoice.processingTimeMs / 1000).toFixed(1)} seconds.`);
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

  const updateCell = (rowIndex: number, columnIndex: number, value: string) => {
    setResult((current) => current ? {
      ...current,
      rows: current.rows.map((row, index) => index !== rowIndex ? row : {
        ...row,
        values: row.values.map((cell, cellIndex) => cellIndex === columnIndex ? value : cell),
      }),
    } : current);
  };

  const updateSummary = (index: number, field: "label" | "amount", value: string) => {
    setResult((current) => current ? {
      ...current,
      summaryRows: current.summaryRows.map((row, rowIndex) => rowIndex !== index ? row : { ...row, [field]: value }),
    } : current);
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
          <span className="eyebrow">Gemini vision → strict JSON → Excel</span>
          <h1>Invoice table extractor</h1>
          <p>Gemini reads the invoice layout, detects the printed column headings and product rows, preserves tax lines, and returns JSON. Excel is generated locally from the editable JSON.</p>
        </div>
        <div className="privacy-badge">No database · key used per request</div>
      </header>

      <section className="control-grid">
        <article className="panel setup-panel">
          <div className="panel-heading"><span className="step">1</span><div><h2>Gemini access</h2><p>Use a key from Google AI Studio. It is never committed or stored on the server.</p></div></div>
          <label className="field-label" htmlFor="api-key">Gemini API key</label>
          <input id="api-key" className="text-input" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="AIza…" autoComplete="off" />
          <label className="remember-row"><input type="checkbox" checked={rememberKey} onChange={(event) => setRememberKey(event.target.checked)} /> Remember only for this browser tab</label>
          <label className="field-label" htmlFor="model">Model</label>
          <select id="model" className="text-input" value={model} onChange={(event) => setModel(event.target.value)}>{MODELS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select>
        </article>

        <article className="panel upload-panel">
          <div className="panel-heading"><span className="step">2</span><div><h2>Invoice image</h2><p>Use a clear, straight photo. Small item rows need readable pixels.</p></div></div>
          <label className="drop-zone"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)} /><strong>{file?.name ?? "Choose JPG, PNG, or WebP"}</strong><span>{file ? bytesLabel(file.size) : "The browser compresses the request below 2.65 MB."}</span></label>
          {prepared && <div className="image-meta"><img src={prepared.previewUrl} alt="Prepared invoice preview" /><div><strong>{prepared.processedWidth} × {prepared.processedHeight}</strong><span>{bytesLabel(prepared.processedBytes)} sent to Gemini</span>{prepared.warnings.map((warning) => <small key={warning}>{warning}</small>)}</div></div>}
        </article>
      </section>

      <section className="panel evidence-panel">
        <div className="panel-heading"><span className="step">3</span><div><h2>Optional OCR evidence</h2><p>Paste existing PharmaCare OCR text here. Gemini will use it as evidence, not as unquestioned truth.</p></div></div>
        <textarea className="ocr-input" value={ocrEvidence} onChange={(event) => setOcrEvidence(event.target.value)} placeholder="Optional: paste flat OCR text or OCR boxes here…" />
      </section>

      <section className="run-bar">
        <div><strong>{status}</strong><span>The model must return null for unreadable values instead of inventing them.</span></div>
        <div className="actions">
          <button className="ghost-button" onClick={() => { setResult(DEMO_RESULT); setFile(new File(["demo"], "demo-invoice.jpg", { type: "image/jpeg" })); setActiveTab("table"); setStatus("Loaded demo JSON to test editing and Excel download."); }}>Load demo</button>
          {processing && <button className="ghost-button" onClick={cancel}>Cancel</button>}
          <button className="primary-button" disabled={!prepared || !apiKey.trim() || processing} onClick={() => void runExtraction()}>{processing ? "Analysing invoice…" : "Extract table with Gemini"}</button>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}

      {result && <section className="results-shell">
        <div className="results-toolbar">
          <div className="stats"><span><strong>{result.columns.length}</strong> columns</span><span><strong>{result.rows.length}</strong> rows</span><span><strong>{result.summaryRows.length}</strong> summary lines</span><span className={reviewCount ? "warning-stat" : "ok-stat"}><strong>{reviewCount}</strong> review flags</span></div>
          <div className="toolbar-actions"><div className="tabs"><button className={activeTab === "table" ? "active" : ""} onClick={() => setActiveTab("table")}>Table</button><button className={activeTab === "review" ? "active" : ""} onClick={() => setActiveTab("review")}>Review</button><button className={activeTab === "json" ? "active" : ""} onClick={() => setActiveTab("json")}>JSON</button></div><button className="primary-button" disabled={exporting} onClick={() => void downloadExcel()}>{exporting ? "Building Excel…" : "Download Excel"}</button></div>
        </div>

        {activeTab === "table" && <div className="table-layout">
          {prepared && <aside className="source-preview"><h3>Source image</h3><img src={prepared.previewUrl} alt="Invoice source" /></aside>}
          <div className="table-card"><div className="table-scroll"><table><thead><tr><th className="row-index">#</th>{result.columns.map((column) => <th key={column.id}>{column.header}</th>)}</tr></thead><tbody>{result.rows.map((row, rowIndex) => <tr key={`${row.rowNumber}-${rowIndex}`}><td className="row-index">{row.rowNumber}</td>{result.columns.map((column, columnIndex) => <td key={column.id}><textarea value={row.values[columnIndex] ?? ""} onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)} aria-label={`Row ${row.rowNumber} ${column.header}`} /></td>)}</tr>)}</tbody></table></div>
            <div className="summary-editor">{result.summaryRows.map((summary, index) => <div className="summary-line" key={`${summary.kind}-${index}`}><span className="kind-pill">{summary.kind.replaceAll("_", " ")}</span><input value={summary.label} onChange={(event) => updateSummary(index, "label", event.target.value)} /><input value={summary.amount ?? ""} onChange={(event) => updateSummary(index, "amount", event.target.value)} /></div>)}<div className="summary-line final-line"><strong>Final amount</strong><span /><input value={result.finalAmount ?? ""} onChange={(event) => setResult((current) => current ? { ...current, finalAmount: event.target.value } : current)} /></div></div>
          </div>
        </div>}

        {activeTab === "review" && <div className="review-grid"><article><h3>Model warnings</h3>{result.warnings.length ? result.warnings.map((warning) => <p key={warning}>{warning}</p>) : <p className="muted">No model warnings.</p>}</article><article><h3>Unresolved text</h3>{result.unresolvedText.length ? result.unresolvedText.map((text) => <p key={text}>{text}</p>) : <p className="muted">No unresolved text.</p>}</article><article className="full-width"><h3>Row warnings</h3>{result.rows.some((row) => row.warnings.length) ? result.rows.flatMap((row) => row.warnings.map((warning) => <p key={`${row.rowNumber}-${warning}`}><strong>Row {row.rowNumber}:</strong> {warning}</p>)) : <p className="muted">No row-specific warnings.</p>}</article></div>}
        {activeTab === "json" && <pre className="json-view">{JSON.stringify(result, null, 2)}</pre>}
      </section>}

      <footer><strong>Important:</strong> This is an extraction assistant. Verify batch, expiry, quantity, rate, taxes, and final amount before importing anything into pharmacy inventory.</footer>
    </main>
  );
}
