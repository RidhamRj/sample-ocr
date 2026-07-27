# PharmacyCare OCR Origin

PharmacyCare was used **read-only**. The standalone repository does not import PharmacyCare at runtime and does not call a PharmacyCare deployment.

## Source snapshot

- Repository: `RidhamRj/PharmacyCare`
- Branch: `main`
- Commit: `63aa1434ffdadd59ec4b5ba648e0201b9c8f4ca7`
- Commit message: `Merge supplier bill scanning and invoice table fixes (#40)`
- Date recorded: 2026-07-26

## Source files inspected

| PharmacyCare file | Blob SHA | Use in sample-ocr |
|---|---|---|
| `api/index.py` | `8b77e72ab2b0fef93edfc7293775c760e32f1b53` | Adapted the bounded FastAPI upload route, lazy RapidOCR singleton, box normalization, confidence normalization, reading order, image decode/resize, health/self-test and JSON response shape |
| `api/rapidocr_onnxruntime/__init__.py` | `5df61d3e2fcccccdc943d5c713cee5f4a8344710` | Inspected compatibility behavior only; sample-ocr imports the maintained `rapidocr` package directly |
| `api/prepare_vercel_ocr.py` | `079a74d720d9925b3072a794d11df22ab3293579` | Adapted one-thread ONNX Runtime settings and NumPy-compatible box normalization |
| `requirements.txt` | `37c7bafb1d698e50d2008e5fdc4495d08e333ce2` | Used as the compatibility baseline for FastAPI, ONNX Runtime, NumPy, Pillow and OpenCV pins |
| `vercel.json` | inspected at the source commit | Used only to understand the prior Vercel routing/dependency packaging approach |

## Functions and behavior adapted

`api/ocr_core.py` independently carries the stable reading layer:

- strict page, image-byte, total-byte and dimension limits;
- optional constant-time API-key validation;
- one process-level, lock-protected RapidOCR engine;
- one request lock to avoid concurrent ONNX memory spikes;
- conversion of RapidOCR tuple/result-object outputs into normalized boxes;
- line confidence clamping and deterministic reading order;
- Pillow image validation, RGB conversion and bounded resize;
- JSON-only response with page size, text, confidence, box, order and diagnostics;
- health and self-test routes.

The service name, limits, output contract and diagnostics were rewritten for the standalone application. `words` currently aliases RapidOCR line boxes and explicitly reports `wordLevelBoxes: false`; the fusion layer therefore never splits a line merely on spaces.

## Explicit exclusions

The following PharmacyCare behavior was **not copied**:

- `_cluster_centers`, `_offset_crop_lines` and `_refine_merged_vertical_lines` from the source route, because local invoice-row re-OCR was not justified by the V1 benchmark;
- invoice-table reconstruction and parsers;
- `supplierInvoiceLayoutStrategy.ts` or any supplier-specific layout/profile logic;
- branches such as `agents/supplier-bill-worksheet-reconciliation-ux`;
- inventory scanning controllers and services;
- supplier matching, bill calculations, GST, totals or reconciliation;
- database clients, schemas, migrations or storage;
- medicine matching, review drafts, approval or save workflows;
- frontend inventory or supplier components.

## Independence check

Repository searches and CI fail if production code contains a PharmacyCare import, URL, inventory call or database package. The only remaining PharmacyCare references are this provenance document and research history.
