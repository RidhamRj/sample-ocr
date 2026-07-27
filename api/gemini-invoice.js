export const SUPPORTED_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
];

export const DEFAULT_MODEL = "gemini-3.5-flash";

const ALLOWED_MODELS = new Set(SUPPORTED_MODELS);
const RETIRED_MODEL_ALIASES = new Map([
  ["gemini-2.5-flash", DEFAULT_MODEL],
  ["gemini-2.5-flash-lite", "gemini-3.1-flash-lite"],
]);
const MAX_BASE64_CHARS = 3_500_000;
const MAX_OCR_EVIDENCE_CHARS = 80_000;
const REQUEST_TIMEOUT_MS = 110_000;

const SUMMARY_KINDS = [
  "subtotal",
  "discount",
  "cgst",
  "sgst",
  "igst",
  "cess",
  "freight",
  "handling",
  "round_off",
  "taxable_amount",
  "credit_adjustment",
  "debit_adjustment",
  "final_amount",
  "other",
];

const GST_JURISDICTIONS = [
  "intrastate",
  "interstate",
  "not_applicable",
  "unknown",
];

export const invoiceSchema = {
  type: "object",
  properties: {
    documentType: { type: "string", description: "Printed document type such as Tax Invoice or Purchase Invoice." },
    supplierName: { type: "string", nullable: true, description: "Exact printed legal or trade name of the supplier/vendor issuing the invoice, not the buyer/customer." },
    invoiceNumber: { type: "string", nullable: true, description: "Exact printed invoice, bill, tax invoice, or document number." },
    billDate: { type: "string", nullable: true, description: "Exact printed invoice or bill date. Preserve the printed format and do not invent a missing date." },
    gstJurisdiction: {
      type: "string",
      enum: GST_JURISDICTIONS,
      description: "intrastate for CGST+SGST or matching supplier/buyer GST state codes; interstate for IGST or different state codes; not_applicable when GST does not apply; unknown when evidence is insufficient or conflicting.",
    },
    tableTitle: { type: "string", nullable: true, description: "Printed title of the main product table, when present." },
    currency: { type: "string", nullable: true, description: "Currency code or printed currency symbol, usually INR for Indian pharmacy invoices." },
    columns: {
      type: "array",
      description: "Every printed column in the main item table, preserved from left to right.",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Stable lowercase snake_case identifier inferred from the printed header." },
          header: { type: "string", description: "The exact or closest readable printed column heading." },
        },
        required: ["id", "header"],
      },
    },
    rows: {
      type: "array",
      description: "Every product row in printed order. Do not include tax summary rows here.",
      items: {
        type: "object",
        properties: {
          rowNumber: { type: "integer" },
          values: {
            type: "array",
            items: { type: "string", nullable: true },
            description: "One value per detected column, in exactly the same order as columns. Preserve blank cells as null.",
          },
          confidence: { type: "number", nullable: true, description: "Confidence from 0 to 1 for the complete row." },
          warnings: { type: "array", items: { type: "string" } },
        },
        required: ["rowNumber", "values", "confidence", "warnings"],
      },
    },
    summaryRows: {
      type: "array",
      description: "All printed monetary totals, taxes, discounts, freight, round-off, and adjustments affecting the payable amount.",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Exact printed label, including percentage when printed." },
          amount: { type: "string", nullable: true, description: "Exact printed monetary value. Never recalculate or repair it." },
          kind: { type: "string", enum: SUMMARY_KINDS },
        },
        required: ["label", "amount", "kind"],
      },
    },
    finalAmount: { type: "string", nullable: true, description: "Exact printed payable, net, grand total, or invoice final amount." },
    unresolvedText: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
    extractionConfidence: { type: "number", nullable: true, description: "Overall extraction confidence from 0 to 1." },
  },
  required: [
    "documentType",
    "supplierName",
    "invoiceNumber",
    "billDate",
    "gstJurisdiction",
    "tableTitle",
    "currency",
    "columns",
    "rows",
    "summaryRows",
    "finalAmount",
    "unresolvedText",
    "warnings",
    "extractionConfidence",
  ],
};

export const extractionPrompt = `You are converting a pharmacy supplier invoice image into strict JSON that will be used to create an Excel workbook.

SUPPLIER AND INVOICE IDENTITY
1. supplierName must be the exact printed legal or trade name of the supplier/vendor issuing the invoice. Do not return the buyer, customer, consignee, or pharmacy name.
2. invoiceNumber must preserve the exact printed invoice, bill, tax invoice, or document number, including slashes, dashes, letters, and leading zeroes. Use null when it cannot be read.
3. billDate must preserve the exact printed invoice or bill date. Do not silently convert or guess the date format. Use null when it cannot be read.
4. gstJurisdiction must be one of: intrastate, interstate, not_applicable, unknown. Use intrastate when CGST and SGST are charged or supplier and buyer GST state codes clearly match. Use interstate when IGST is charged or the state codes clearly differ. Use not_applicable only when the document clearly indicates GST does not apply. Use unknown when the evidence is missing, ambiguous, or conflicting. Do not decide from an address alone when uncertain.

MAIN ITEM TABLE
5. Visually inspect the invoice and identify the actual printed item-table column headings from left to right.
6. Include every printed item-table column, even serial number, pack, HSN, batch, expiry, quantity, free quantity, MRP, rate, discount, GST percentage, tax value, or amount columns.
7. Return every product or item row in exactly the same order as printed.
8. Each row values array MUST have exactly one value for every detected column and MUST follow the columns array order.
9. Preserve printed text and decimal precision. Preserve product names, pack formats, batch numbers, expiry formats, quantities, rates, discounts, GST values, and amounts.
10. Keep wrapped product descriptions in their original row. Never merge two distinct product rows and never repeat a row.
11. Preserve genuinely blank cells as null. Never shift later values left when a printed cell is blank.

TAXES, TOTALS, AND ADJUSTMENTS
12. Extract every monetary summary line that affects the invoice total, including subtotal, taxable amount, trade/cash/scheme discount, CGST, SGST, IGST, cess, freight, handling, delivery, round-off, credit/debit adjustment, and other printed adjustments.
13. Keep tax or HSN summary-table lines out of product rows. Include their monetary totals in summaryRows when they affect the invoice total.
14. Preserve each printed summary label and amount. Do not calculate, repair, or invent a value merely to make totals match.
15. finalAmount must contain the exact printed payable, net, grand-total, or invoice amount. Use null only when it truly cannot be read.

RELIABILITY RULES
16. Supplier and buyer GSTIN state codes may be used only to determine gstJurisdiction. Do not return GSTINs, supplier address, phone, customer details, bank details, declarations, signatures, or unrelated prose.
17. Never invent unreadable text or numbers. Use null and describe the uncertainty in warnings or unresolvedText.
18. The image is the primary source. OCR evidence, when supplied, is supporting evidence only and may contain mistakes.
19. Return only schema-conforming JSON. Do not return markdown or explanatory prose.`;

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

function normalizeId(value, fallback) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return normalized || fallback;
}

function nullableString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function stringArray(value) {
  return Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
}

function confidence(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

function gstJurisdiction(value) {
  return GST_JURISDICTIONS.includes(value) ? value : "unknown";
}

export function validateInvoice(rawInvoice) {
  if (!rawInvoice || typeof rawInvoice !== "object") throw new Error("Gemini returned no invoice object.");
  if (!Array.isArray(rawInvoice.columns) || rawInvoice.columns.length === 0) throw new Error("Gemini did not detect a product-table header.");
  if (!Array.isArray(rawInvoice.rows) || rawInvoice.rows.length === 0) throw new Error("Gemini did not detect any product rows.");

  const usedIds = new Map();
  const columns = rawInvoice.columns.map((column, index) => {
    const header = String(column?.header ?? column?.id ?? `Column ${index + 1}`).trim() || `Column ${index + 1}`;
    const baseId = normalizeId(column?.id || header, `column_${index + 1}`);
    const count = usedIds.get(baseId) ?? 0;
    usedIds.set(baseId, count + 1);
    return { id: count === 0 ? baseId : `${baseId}_${count + 1}`, header };
  });

  const rows = rawInvoice.rows.map((row, index) => {
    const sourceValues = Array.isArray(row?.values) ? row.values : [];
    const values = Array.from({ length: columns.length }, (_, columnIndex) => nullableString(sourceValues[columnIndex]));
    return {
      rowNumber: Number.isInteger(row?.rowNumber) && row.rowNumber > 0 ? row.rowNumber : index + 1,
      values,
      confidence: confidence(row?.confidence),
      warnings: stringArray(row?.warnings),
    };
  });

  const summaryRows = Array.isArray(rawInvoice.summaryRows)
    ? rawInvoice.summaryRows.map((summary) => ({
        label: String(summary?.label ?? "").trim(),
        amount: nullableString(summary?.amount),
        kind: SUMMARY_KINDS.includes(summary?.kind) ? summary.kind : "other",
      }))
    : [];

  const warnings = stringArray(rawInvoice.warnings);
  const finalAmount = nullableString(rawInvoice.finalAmount);
  if (!finalAmount) warnings.push("Final payable amount was not confidently extracted. Verify the invoice footer manually.");

  return {
    documentType: String(rawInvoice.documentType ?? "Invoice").trim() || "Invoice",
    supplierName: nullableString(rawInvoice.supplierName),
    invoiceNumber: nullableString(rawInvoice.invoiceNumber),
    billDate: nullableString(rawInvoice.billDate),
    gstJurisdiction: gstJurisdiction(rawInvoice.gstJurisdiction),
    tableTitle: nullableString(rawInvoice.tableTitle),
    currency: nullableString(rawInvoice.currency),
    columns,
    rows,
    summaryRows,
    finalAmount,
    unresolvedText: stringArray(rawInvoice.unresolvedText),
    warnings,
    extractionConfidence: confidence(rawInvoice.extractionConfidence),
  };
}

function getApiKey(request) {
  const serverKey = process.env.GEMINI_API_KEY?.trim();
  if (serverKey) return serverKey;

  const allowsUserKey = process.env.ALLOW_USER_GEMINI_KEY !== "false";
  if (!allowsUserKey) return null;
  const headerValue = request.headers["x-gemini-api-key"];
  const key = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return typeof key === "string" ? key.trim() : null;
}

export function resolveRequestedModel(value) {
  const requested = typeof value === "string" ? value.trim() : "";
  return RETIRED_MODEL_ALIASES.get(requested) || (ALLOWED_MODELS.has(requested) ? requested : DEFAULT_MODEL);
}

function modelCandidates(requestedModel) {
  return [requestedModel, ...SUPPORTED_MODELS].filter((model, index, all) => all.indexOf(model) === index);
}

function isModelAvailabilityError(status, message) {
  if (![400, 403, 404].includes(status)) return false;
  return /model|models\//i.test(message)
    && /not found|not available|no longer available|unsupported|does not exist|not enabled|new users/i.test(message);
}

async function requestGemini({ apiKey, model, imageBase64, mimeType, evidence, signal }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: extractionPrompt + evidence },
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
          ],
        }],
        generationConfig: {
          maxOutputTokens: 32768,
          responseMimeType: "application/json",
          responseSchema: invoiceSchema,
        },
      }),
      signal,
    },
  );

  const data = await response.json().catch(() => null);
  return { response, data };
}

export const config = { maxDuration: 120 };

export default async function handler(request, response) {
  const serverKeyConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
  const allowsUserKey = process.env.ALLOW_USER_GEMINI_KEY !== "false";

  if (request.method === "GET") {
    return sendJson(response, 200, {
      status: "ok",
      service: "sample-ocr Gemini invoice extractor",
      models: SUPPORTED_MODELS,
      defaultModel: DEFAULT_MODEL,
      serverKeyConfigured,
      allowsUserKey,
    });
  }
  if (request.method !== "POST") return sendJson(response, 405, { error: "Use POST for invoice extraction." });

  const apiKey = getApiKey(request);
  if (!apiKey || apiKey.length < 20) {
    return sendJson(response, 400, {
      error: serverKeyConfigured
        ? "The configured Gemini API key is invalid."
        : "Paste a valid Gemini API key or configure GEMINI_API_KEY on the server.",
    });
  }

  let body;
  try {
    body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
  } catch {
    return sendJson(response, 400, { error: "The request body is not valid JSON." });
  }

  const requestedModel = typeof body?.model === "string" ? body.model : DEFAULT_MODEL;
  const resolvedModel = resolveRequestedModel(requestedModel);
  const imageBase64 = body?.imageBase64;
  const mimeType = body?.mimeType === "image/jpeg" ? "image/jpeg" : null;
  const ocrEvidence = typeof body?.ocrEvidence === "string" ? body.ocrEvidence.slice(0, MAX_OCR_EVIDENCE_CHARS) : "";

  if (!mimeType || typeof imageBase64 !== "string" || imageBase64.length < 1000) {
    return sendJson(response, 400, { error: "A prepared JPEG invoice image is required." });
  }
  if (imageBase64.length > MAX_BASE64_CHARS) {
    return sendJson(response, 413, { error: "The prepared image is too large. Crop empty margins and retry." });
  }

  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const evidence = ocrEvidence ? `\n\nOPTIONAL OCR EVIDENCE FROM ANOTHER ENGINE:\n${ocrEvidence}` : "";
  const attemptedModels = [];

  try {
    for (const model of modelCandidates(resolvedModel)) {
      attemptedModels.push(model);
      const { response: upstream, data: upstreamData } = await requestGemini({
        apiKey,
        model,
        imageBase64,
        mimeType,
        evidence,
        signal: controller.signal,
      });

      if (!upstream.ok) {
        const upstreamMessage = upstreamData?.error?.message || `Gemini returned HTTP ${upstream.status}.`;
        if (isModelAvailabilityError(upstream.status, upstreamMessage) && attemptedModels.length < SUPPORTED_MODELS.length) {
          continue;
        }
        const status = upstream.status === 429 ? 429 : upstream.status === 400 || upstream.status === 403 || upstream.status === 404 ? 400 : 502;
        return sendJson(response, status, {
          error: upstreamMessage,
          attemptedModels,
        });
      }

      const rawText = extractText(upstreamData);
      if (!rawText) {
        const finishReason = upstreamData?.candidates?.[0]?.finishReason;
        return sendJson(response, 502, {
          error: finishReason
            ? `Gemini returned no structured output (finish reason: ${finishReason}).`
            : "Gemini returned no structured output.",
          model,
        });
      }

      let parsed;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        return sendJson(response, 502, { error: "Gemini returned malformed JSON despite structured-output mode.", model });
      }

      const invoice = validateInvoice(parsed);
      return sendJson(response, 200, {
        ...invoice,
        model,
        requestedModel,
        fallbackUsed: model !== requestedModel,
        processingTimeMs: Date.now() - started,
      });
    }

    return sendJson(response, 502, {
      error: "No supported Gemini model was available for this API project.",
      attemptedModels,
    });
  } catch (error) {
    if (error?.name === "AbortError") return sendJson(response, 504, { error: "Gemini did not respond within 110 seconds." });
    return sendJson(response, 500, { error: error instanceof Error ? error.message : "Unexpected Gemini proxy failure." });
  } finally {
    clearTimeout(timeout);
  }
}