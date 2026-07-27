# sample-ocr

Standalone pharmacy supplier-invoice **image → Gemini JSON → editable Excel** test application.

The production path no longer depends on OpenCV table detection, RapidOCR, ONNX Runtime, Python, a GPU, or a database. Gemini interprets the invoice image, returns strict JSON, the browser lets the user correct it, and ExcelJS builds the workbook locally.

## Active branch

```text
agents/gemini-invoice-json-v1
```

## Architecture

```text
invoice image
  -> browser orientation, resize, and JPEG compression
  -> Vercel Node function
       image + optional PharmaCare OCR evidence
       Gemini structured-output request
       JSON normalization and response checks
  -> editable browser worksheet
       dynamic printed column headings
       every item row
       all tax / discount / adjustment rows
       final payable amount
       deterministic validation warnings
  -> local ExcelJS workbook
       Invoice Table
       Gemini JSON
       Validation
```

## What Gemini must extract

- every printed column heading from left to right;
- every product row in printed order;
- blank cells as `null` so later values do not shift;
- pack, batch, expiry, quantity, free quantity, MRP, rate, discount, GST, tax and amount fields when present;
- subtotal and taxable value;
- trade, cash and scheme discounts;
- CGST, SGST, IGST and cess;
- freight, handling, round-off and credit/debit adjustments;
- the exact printed final payable amount.

Supplier address, phone, GSTIN, declarations, bank details and unrelated prose are intentionally excluded from V1.

## Reliability boundary

Structured output guarantees the JSON shape, not factual correctness. The app therefore:

- preserves the source image beside the extracted table;
- allows headings, cells, rows, summary lines and final amount to be edited;
- flags missing final amounts, blank or duplicate rows, invalid numeric-looking cells, low confidence and unresolved text;
- includes all warnings in the exported workbook;
- never writes directly to pharmacy inventory.

Human review remains mandatory before using batch, expiry, quantity, rate, tax or final amount data.

## Requirements

- Node.js 22
- npm
- a modern browser with `createImageBitmap` and canvas support
- a Gemini API key from Google AI Studio, unless a server key is configured

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Vite serves the frontend. The Vercel API function is available when running through Vercel development or deployment tooling.

## Gemini key modes

### Recommended shared deployment

Configure this only on the server:

```env
GEMINI_API_KEY=your_key
ALLOW_USER_GEMINI_KEY=false
```

The browser never receives the server key.

### Test deployment

Leave `GEMINI_API_KEY` empty and use:

```env
ALLOW_USER_GEMINI_KEY=true
```

The user pastes their own key in the UI. It is sent only in the request header and may optionally be remembered in that browser tab through `sessionStorage`. It is not written to the repository or stored by the API function.

## API

### Health and capabilities

```http
GET /api/gemini-invoice
```

Returns supported models and whether the deployment has a server key.

### Extract invoice

```http
POST /api/gemini-invoice
Content-Type: application/json
x-gemini-api-key: optional-user-key
```

Request body:

```json
{
  "model": "gemini-2.5-flash",
  "mimeType": "image/jpeg",
  "imageBase64": "...",
  "ocrEvidence": "optional PharmaCare OCR text or boxes"
}
```

The key header is unnecessary when `GEMINI_API_KEY` is configured on the server.

## Supported models

- `gemini-2.5-flash` — default free-tier test model;
- `gemini-3.5-flash` — stronger visual reasoning when available to the project;
- `gemini-3.1-flash-lite` — lower-cost/quota-friendly alternative.

## Excel output

The browser generates the workbook from the reviewed JSON. The workbook contains:

1. `Invoice Table` — dynamic item columns, every product row, taxes, totals and final amount;
2. `Gemini JSON` — the complete reviewed JSON;
3. `Validation` — deterministic errors and warnings.

All source cell values remain strings so batch numbers, expiry formats, leading zeros and printed decimal precision are not silently changed.

## Validation

No Gemini key is used during automated tests.

```bash
npm run validate
```

This runs:

- Node syntax validation for the Vercel API;
- Gemini structured-output contract tests;
- JSON normalization and deterministic validation tests;
- JSON-to-XLSX workbook compatibility tests;
- TypeScript and Vite production build.

## Vercel

`vercel.json`:

- builds the Vite frontend into `dist/`;
- deploys `api/gemini-invoice.js` as a Node function;
- allows up to 120 seconds for Gemini processing;
- keeps Git automatic deployments disabled;
- rewrites non-API routes to the Vite application.

The browser compresses a single invoice image before upload so the Base64 JSON request remains below Vercel's body-size boundary.

## Privacy

Invoices sent through the free Gemini tier are processed by Google under the terms of that tier. Do not send prescriptions, patient information, customer phone numbers or unrelated personal data. A commercial pharmacy deployment should review data-processing requirements and use an appropriate paid configuration before onboarding external customers.
