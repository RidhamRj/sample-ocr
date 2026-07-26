# sample-ocr

Standalone **image-to-editable-Excel** application. It preserves invoice table geometry and blank cells instead of flattening OCR text into shifting rows.

## Architecture

```text
image
  -> browser EXIF orientation + resize/compression
  -> lazy OpenCV.js Web Worker
       page contour / perspective / deskew
       horizontal + vertical lines
       intersections / row + column boundaries
       explicit cell rectangles
  -> standalone Vercel Python RapidOCR function
       JSON text boxes only
  -> browser OCR-box / cell fusion
  -> canonical table JSON
  -> editable worksheet
  -> lazy ExcelJS XLSX export
```

There is **no database, inventory code, supplier parser, paid API, server-side XLSX generation or PharmacyCare runtime dependency**.

## Branch

Implementation target: `agents/image-to-excel-cell-reconstruction-v1`.

## Requirements

- Node.js 22
- Python 3.12 for Vercel parity
- A modern browser with Web Workers, WebAssembly, `createImageBitmap` and canvas support

## Local setup

```bash
npm install
npm run prepare:opencv
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

Start the OCR API:

```bash
uvicorn api.index:app --reload --port 8000
```

Start Vite in another terminal:

```bash
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8000`.

## Environment

Copy `.env.example` when needed.

- `OCR_API_KEY`: optional server secret. When configured, clients must send `x-api-key`.
- `VITE_OCR_API_KEY`: matching browser build value for private deployments. Do not treat a Vite variable as a durable secret in a public frontend.
- `OCR_MAX_IMAGE_BYTES`: server hard limit, clamped to 3.6 MB.
- `OCR_MAX_TOTAL_BYTES`: server hard limit, clamped to 3.8 MB.
- `OCR_MAX_IMAGE_DIMENSION`: server resize limit, clamped to 2,800 px.
- `OCR_MAX_ITEMS`: maximum JSON OCR items, clamped to 4,000.
- `OPENCV_JS_URL`: optional build-time override for the official OpenCV.js download.

For a public Hobby demo, leave `OCR_API_KEY` unset and rely on strict one-page/payload limits plus Vercel abuse controls. A browser-exposed `VITE_OCR_API_KEY` is not secret.

## Vercel deployment

The repository is a single Vercel project:

- Vite static frontend from `dist/`;
- FastAPI function at `api/index.py`;
- rewrite from `/api/*` to the function;
- official OpenCV.js downloaded during `prebuild` and served as `/vendor/opencv.js`;
- frontend/tests/fixtures excluded from the Python function bundle;
- XLSX generated in the browser.

Official limits used by the design are documented in `docs/OPEN_SOURCE_EVALUATION.md`. Client image preparation targets **3.2 MB**, below the server hard limit and Vercel's 4.5 MB function body limit.

## Canonical JSON

The worksheet and exporter consume the same `CanonicalDocument` object. Each cell includes:

- table, row and column identity;
- rectangle in normalized page coordinates;
- row/column spans;
- text and source OCR IDs;
- confidence, warning and manual-edit state.

Unassigned OCR is retained separately. Empty cells remain explicit objects. Wide text lines that cross several columns are left unresolved rather than split on spaces.

## XLSX output

Export is lazy and local. The workbook contains:

1. one worksheet per detected table;
2. `Raw OCR`;
3. `Unassigned OCR`;
4. `Diagnostics`.

It preserves blank coordinates, merges, row heights, column widths, wrapped text and warning styles.

## Tests and benchmarks

```bash
npm test
npm run build
npm run check:python
npm run benchmark:fixtures
npm run benchmark:python
npm run benchmark:browser
python scripts/verify_xlsx.py benchmarks/results/browser-export-compatibility.xlsx
```

The browser benchmark runs the production OpenCV worker in headless Chromium. Candidate B is isolated under `experiments/` and is never imported by the production API.

Research and evidence:

- `docs/OPEN_SOURCE_EVALUATION.md`
- `docs/PHARMACYCARE_OCR_ORIGIN.md`
- `docs/ARCHITECTURE_BENCHMARK.md`
- `THIRD_PARTY_NOTICES.md`

## Current V1 boundaries

- images only: PNG, JPEG and WebP;
- one page per request;
- OCR boxes are RapidOCR line-level boxes unless a future benchmark proves a safe word-level path;
- borderless reconstruction requires at least three repeated rows and columns;
- no medicine-header inference, supplier templates or business calculations;
- real invoice accuracy must be measured before claiming universal reliability.
