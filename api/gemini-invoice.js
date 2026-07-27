const ALLOWED_MODELS = new Set(["gemini-2.5-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite"]);
const MAX_BASE64_CHARS = 3_650_000;

const invoiceSchema = {
  type: "object",
  properties: {
    documentType: { type: "string", description: "Printed document type such as Tax Invoice or Purchase Invoice." },
    tableTitle: { type: ["string", "null"], description: "Printed title of the main product table, when present." },
    currency: { type: ["string", "null"], description: "Currency code or printed currency symbol, usually INR for Indian pharmacy invoices." },
    columns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Stable lowercase snake_case identifier inferred from the printed header." },
          header: { type: "string", description: "The exact printed column heading, preserved from left to right." }
        },
        required: ["id", "header"]
      }
    },
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rowNumber: { type: "integer" },
          values: { type: "array", items: { type: ["string", "null"] }, description: "One value per detected column, in exactly the same order as columns." },
          confidence: { type: ["number", "null"] },
          warnings: { type: "array", items: { type: "string" } }
        },
        required: ["rowNumber", "values", "confidence", "warnings"]
      }
    },
    summaryRows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Exact printed label, including percentage when printed." },
          amount: { type: ["string", "null"], description: "Exact printed monetary value without recalculating it." },
          kind: { type: "string", enum: ["subtotal", "discount", "cgst", "sgst", "igst", "cess", "freight", "round_off", "taxable_amount", "final_amount", "other"] }
        },
        required: ["label", "amount", "kind"]
      }
    },
    finalAmount: { type: ["string", "null"], description: "The exact printed payable, net, grand total, or invoice final amount." },
    unresolvedText: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
    extractionConfidence: { type: ["number", "null"] }
  },
  required: ["documentType", "tableTitle", "currency", "columns", "rows", "summaryRows", "finalAmount", "unresolvedText", "warnings", "extractionConfidence"]
};

const prompt = `You are extracting the main item table from a pharmacy supplier invoice image into strict JSON for an Excel workbook.

PRIMARY TASK
1. Inspect the image visually and identify the actual printed item-table column headings from left to right.
2. Return every product or item row in the same order as printed.
3. Return one value per column for every row. values.length MUST equal columns.length.
4. Preserve exact printed text for product names, packs, batch numbers, expiry values, quantities, free quantities, MRP, rates, discounts, GST percentages, tax values, and amounts.
5. Keep wrapped product descriptions in their original product row. Never merge two distinct product rows.
6. Preserve blank cells as null. Do not shift later values left when a cell is blank.

SUMMARY AND TAX REQUIREMENTS
7. Extract every monetary summary line that affects the invoice total: subtotal, taxable amount, trade discount, cash discount, scheme discount, CGST, SGST, IGST, cess, freight, delivery, round-off, credit adjustment, and any other printed adjustment.
8. Preserve the printed label and printed amount. Do not calculate or repair a value merely to make totals match.
9. finalAmount must be the exact printed payable, net, grand-total, or invoice final amount. Use null only when it truly cannot be read.

BOUNDARIES
10. Ignore supplier address, phone, GSTIN, customer details, declaration text, bank details, signatures, and general header or footer prose unless the text is part of the product table or a monetary summary.
11. Do not treat HSN or GST summary tables as product rows. Their monetary tax totals may be included in summaryRows when they affect the final total.
12. Do not invent unreadable text or numbers. Use null and explain uncertainty in warnings or unresolvedText.
13. Prefer the image over OCR evidence when OCR evidence conflicts with clearly readable visual text. Treat OCR evidence only as supporting evidence.
14. Return JSON only. No markdown and no explanation outside the schema.`;

function sendJson(response, status, payload) {
  response.status(status);
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(payload));
}

function extractText(data) {
  return data?.candidates
    ?.flatMap((candidate) => candidate?.content?.parts ?? [])
    .map((part) => part?.text)
    .filter(Boolean)
    .join("") ?? "";
}

function validateInvoice(invoice) {
  if (!invoice || typeof invoice !== "object") throw new Error("Gemini returned no invoice object.");
  if (!Array.isArray(invoice.columns) || invoice.columns.length === 0) throw new Error("Gemini did not detect a product table header.");
  if (!Array.isArray(invoice.rows)) throw new Error("Gemini returned an invalid rows array.");

  const columnCount = invoice.columns.length;
  invoice.rows = invoice.rows.map((row, index) => {
    const values = Array.isArray(row.values) ? row.values.slice(0, columnCount) : [];
    while (values.length < columnCount) values.push(null);
    return {
      rowNumber: Number.isInteger(row.rowNumber) ? row.rowNumber : index + 1,
      values,
      confidence: typeof row.confidence === "number" ? Math.max(0, Math.min(1, row.confidence)) : null,
      warnings: Array.isArray(row.warnings) ? row.warnings.map(String) : []
    };
  });

  invoice.summaryRows = Array.isArray(invoice.summaryRows) ? invoice.summaryRows : [];
  invoice.unresolvedText = Array.isArray(invoice.unresolvedText) ? invoice.unresolvedText.map(String) : [];
  invoice.warnings = Array.isArray(invoice.warnings) ? invoice.warnings.map(String) : [];
  if (invoice.finalAmount === null || invoice.finalAmount === undefined || invoice.finalAmount === "") {
    invoice.warnings.push("Final payable amount was not confidently extracted. Verify the invoice footer manually.");
    invoice.finalAmount = null;
  }
  return invoice;
}

export const config = { maxDuration: 120 };

export default async function handler(request, response) {
  if (request.method === "GET") {
    return sendJson(response, 200, { status: "ok", service: "sample-ocr Gemini invoice extractor", models: [...ALLOWED_MODELS] });
  }
  if (request.method !== "POST") return sendJson(response, 405, { error: "Use POST for invoice extraction." });

  const apiKeyHeader = request.headers["x-gemini-api-key"];
  const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
  if (!apiKey || typeof apiKey !== "string" || apiKey.length < 20) return sendJson(response, 400, { error: "A valid Gemini API key is required." });

  let body;
  try {
    body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
  } catch {
    return sendJson(response, 400, { error: "The request body is not valid JSON." });
  }

  const model = ALLOWED_MODELS.has(body?.model) ? body.model : "gemini-2.5-flash";
  const imageBase64 = body?.imageBase64;
  const mimeType = body?.mimeType === "image/jpeg" ? "image/jpeg" : null;
  const ocrEvidence = typeof body?.ocrEvidence === "string" ? body.ocrEvidence.slice(0, 80_000) : "";

  if (!mimeType || typeof imageBase64 !== "string" || imageBase64.length < 1000) return sendJson(response, 400, { error: "A prepared JPEG invoice image is required." });
  if (imageBase64.length > MAX_BASE64_CHARS) return sendJson(response, 413, { error: "The prepared image is too large. Crop empty margins and retry." });

  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 110_000);

  try {
    const evidence = ocrEvidence ? `\n\nOPTIONAL OCR EVIDENCE FROM ANOTHER ENGINE:\n${ocrEvidence}` : "";
    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt + evidence }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: invoiceSchema
        }
      }),
      signal: controller.signal
    });

    const upstreamData = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      const upstreamMessage = upstreamData?.error?.message || `Gemini returned HTTP ${upstream.status}.`;
      const status = upstream.status === 429 ? 429 : upstream.status === 400 || upstream.status === 403 ? 400 : 502;
      return sendJson(response, status, { error: upstreamMessage });
    }

    const rawText = extractText(upstreamData);
    if (!rawText) return sendJson(response, 502, { error: "Gemini returned no structured output." });

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return sendJson(response, 502, { error: "Gemini returned malformed JSON despite structured-output mode." });
    }

    const invoice = validateInvoice(parsed);
    return sendJson(response, 200, { ...invoice, model, processingTimeMs: Date.now() - started });
  } catch (error) {
    if (error?.name === "AbortError") return sendJson(response, 504, { error: "Gemini did not respond within 110 seconds." });
    return sendJson(response, 500, { error: error instanceof Error ? error.message : "Unexpected Gemini proxy failure." });
  } finally {
    clearTimeout(timeout);
  }
}
