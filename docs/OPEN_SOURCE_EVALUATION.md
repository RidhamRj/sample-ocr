# Open-Source Evaluation

Checked on **2026-07-26**. The goal was not to import a complete OCR/table repository. The goal was to select the smallest maintained components that can reconstruct invoice cells on normal user hardware and deploy on Vercel Hobby without paid APIs.

## Decision summary

| Project | License | Activity checked | Runtime / size profile | Image and cell support | Blank / merged cells | XLSX | Browser / Vercel fit | Decision |
|---|---|---|---|---|---|---|---|---|
| [opencv/opencv](https://github.com/opencv/opencv) / OpenCV.js | Apache-2.0 | Active; OpenCV 4.13.0 released 2025-12-31 and official JavaScript documentation/builds are available | C++/Python and Emscripten WebAssembly. The browser asset is large but static and lazy-loaded; no model download or GPU | Direct image processing; contours, morphology, Hough lines, perspective and deskew. It does not itself provide semantic OCR cells | Geometry can explicitly materialize blank rectangles; merged cells require application logic | No | Strong browser fit in a Web Worker; avoids Python geometry dependencies and cold-start cost | **Accept** for browser geometry. Pin 4.13.0, self-host the official build, delete every `cv.Mat` |
| [xavctn/img2table](https://github.com/xavctn/img2table) | MIT | Maintained repository with 169 commits and active issues/PRs when checked | Python; OpenCV plus dataframe/document dependencies. CPU-oriented, no GPU required for geometry | Images and PDFs; exposes table and cell bounding boxes; OCR adapters optional | Supports merged/implicit cells; borderless mode is documented as alpha and requires OCR | Yes, server-side | Useful algorithm/reference benchmark, but its broader Python dependency surface increases Vercel bundle/cold-start risk and duplicates browser functionality | **Reject as production dependency**; **accept concepts/benchmark only**. No source code copied |
| [exceljs/exceljs](https://github.com/exceljs/exceljs) | MIT | Latest stable release found: v4.4.0; repository remains active | JavaScript package; no model or GPU. Loaded only on export so it does not affect initial UI load | Consumes canonical cells rather than images | Supports blank cells, merges, row heights, column widths, wrapping, styles and comments | Browser `workbook.xlsx.writeBuffer()` produces an ArrayBuffer-compatible payload | Good static frontend fit; keeps XLSX bytes out of the Python response | **Accept** for lazy browser-side XLSX generation |
| [naptha/tesseract.js](https://github.com/naptha/tesseract.js) | Apache-2.0 | v7.0.0 released 2025-12-15 | Browser/Node WebAssembly plus worker and language-data downloads; Node 16+ | Images, not PDFs; can expose block/word data | Does not reconstruct table cells or preserve blanks by itself | No | Technically browser-compatible but adds a second OCR model/download and duplicates RapidOCR | **Reject as default**. Keep only as an optional future benchmark/emergency fallback if invoice evidence beats RapidOCR |
| [microsoft/table-transformer](https://github.com/microsoft/table-transformer) | MIT | Official code and models; major project news/model release activity is primarily 2023 | Python 3.10-era PyTorch/Torchvision stack; 110 MB detection weights and 110 MB structure weights before the PyTorch runtime; CPU inference is materially heavier | Images and rendered PDFs; structure model emits rows/columns/cells but OCR text is separate | Training annotations include blank cells; model is designed for structure and headers | HTML/CSV inference examples, not browser XLSX | Poor Vercel Hobby and browser fit: large runtime/models, slow cold CPU execution, no practical browser path | **Reject for V1**; reference only |
| [RapidAI/RapidOCR](https://github.com/RapidAI/RapidOCR) | Apache-2.0 (model copyright noted upstream) | v3.8.1 released 2026-04-11 | Python + ONNX Runtime; compact PaddleOCR-compatible models; CPU supported; no GPU required | Reads images and returns text boxes; no table reconstruction | No | No | Already proven in PharmacyCare, fits a focused Python function better than a full table stack | **Accept** as the only server OCR reader |
| [dream-num/univer](https://github.com/dream-num/univer) | Apache-2.0 | Active; v0.24.0 released 2026-05-23 | Full office/spreadsheet SDK with canvas, formula engine and plugin architecture | Not an image/table detector | Rich spreadsheet editing and merges | Supports spreadsheet workflows | Maintained and permissive, but far broader and heavier than an editable OCR preview needs | **Reject for V1**; use a small purpose-built CSS grid bound directly to canonical JSON |
| [handsontable/handsontable](https://github.com/handsontable/handsontable) | Current releases use proprietary non-commercial/evaluation or paid commercial terms | Active | Browser data grid | Not an image detector | Rich editing and merges | Requires another export layer | Commercial production would require a paid license; conflicts with the no-paid-dependency goal | **Reject** |

## Required criteria by candidate

### OpenCV / OpenCV.js

- **Supported runtime:** native C++/Python and browser JavaScript through Emscripten/WebAssembly.
- **Browser compatibility:** official prebuilt OpenCV.js and official build instructions exist. The production implementation runs it in a classic Web Worker with `OffscreenCanvas`.
- **Python/Node requirements:** browser path has no Python dependency; the download/build helper uses Node 22. Candidate B uses Python OpenCV only in benchmark code.
- **Package/model size:** no ML model. The official JavaScript/WASM payload is a static asset and is excluded from the Python function bundle. CI records its downloaded byte size.
- **CPU/memory/GPU:** CPU/WASM; no GPU requirement. Worker diagnostics and benchmark main-thread lag are recorded. Every created `cv.Mat`, contour, ROI and kernel is deleted.
- **Input:** raster images.
- **Cell boxes:** created by this application from lines/intersections; not a native OpenCV semantic output.
- **Blank cells:** explicitly materialized from row/column boundaries.
- **Merged cells:** inferred only where a separating line is missing; no text-based guessing.
- **XLSX:** not provided.
- **Vercel:** excellent as static frontend work; eliminates Python OpenCV from the production function.
- **Paid API:** none.

### img2table

- **Supported runtime:** Python; standard install supports Tesseract, with optional Paddle/EasyOCR/Surya/cloud integrations.
- **Browser compatibility:** none.
- **Python requirements:** current Python packaging plus OpenCV/dataframe/document stack; exact resolved wheel size is environment-dependent and must be measured from a Vercel build rather than guessed.
- **CPU/memory/GPU:** structural algorithm is CPU-friendly; optional OCR providers can add large models/runtimes. GPU is not required for its OpenCV geometry.
- **Input:** common raster images and native/scanned PDFs; V1 only needs images.
- **Cell boxes:** yes, table-cell bounding boxes are exposed.
- **Blank/merged cells:** merged and implicit content are supported. Borderless extraction is documented as alpha, requires OCR and needs at least three columns.
- **XLSX:** server-side export exists.
- **Vercel:** plausible as a benchmark, but unnecessary Pandas/document/export dependencies and server-side XLSX make the production function larger and colder.
- **Paid API:** not required when using local OCR.
- **Reuse decision:** no code copied. Its table-first, explicit-cell concepts informed the independent implementation.

### ExcelJS

- **Supported runtime:** browser and Node.js.
- **Browser compatibility:** workbook creation and `writeBuffer` are supported. The package is dynamically imported only after the export button is pressed.
- **Node requirement:** the application standardizes on Node 22; ExcelJS itself is not used server-side here.
- **Package/model size:** JavaScript dependency only; no model. Vite reports the lazy chunk size in CI.
- **CPU/memory/GPU:** workbook serialization is CPU/memory work in the browser; no GPU.
- **Input/cells:** consumes canonical JSON; does not inspect images.
- **Blank/merged cells:** blank coordinates are explicitly touched; `mergeCells`, row height, column width, wrap, warning fill and notes are used.
- **XLSX:** yes, generated as a browser buffer/Blob.
- **Vercel:** static asset only; no function response or bundle impact.
- **Paid API:** none.

### Tesseract.js

- **Supported runtime:** modern browsers and Node.js 16+ using WebAssembly and a Web Worker.
- **Browser compatibility:** strong, except environments without WebAssembly such as React Native.
- **Package/model size:** core, worker and language data are downloaded/cached; exact language model size depends on selected data.
- **CPU/memory/GPU:** browser CPU; no GPU required; can be slow on full-resolution invoices.
- **Input:** images; the project explicitly does not support PDFs.
- **Cell boxes:** OCR blocks/words can be requested, but table cells are not reconstructed.
- **Blank/merged cells/XLSX:** no.
- **Vercel:** could eliminate OCR backend, but moves model download and compute to every client and would create a second OCR path.
- **Paid API:** none.
- **Decision:** benchmark only after the RapidOCR invoice baseline exists; do not replace the proven reader on assumption.

### Table Transformer

- **Supported runtime:** Python/PyTorch; official environment references Python 3.10.9, PyTorch 1.13.1 and Torchvision 0.14.1.
- **Browser compatibility:** no practical maintained browser build.
- **Model/package size:** 110 MB table detection model plus 110 MB structure model, and the much larger PyTorch runtime.
- **CPU/memory/GPU:** GPU is not strictly mandatory, but CPU latency and cold initialization are not appropriate for a reliable free Vercel function.
- **Input:** images and rendered PDF pages.
- **Cell boxes:** yes; separate OCR is needed to populate text.
- **Blank/merged cells:** the PubTables-1M representation includes blank cells and detailed structures, but deployment still requires post-processing.
- **XLSX:** no direct browser XLSX path.
- **Vercel:** rejected because model/runtime size, downloads and CPU cold-start risk are disproportionate to V1.
- **Paid API:** none, but infrastructure cost/reliability is the blocker.

## Vercel constraints used in the design

Official Vercel documentation checked on 2026-07-26 states:

- Function request and response bodies are limited to **4.5 MB**.
- Standard Python functions have a maximum **500 MB uncompressed** bundle.
- Hobby memory is **2 GB / 1 vCPU**.
- With Fluid Compute, Hobby duration is up to **300 seconds**; older/non-Fluid projects default to 10 seconds and can be configured up to 60 seconds.
- Hobby allows **one concurrent build**, 45 minutes per build, and 100 deployments per day.
- Python does not automatically tree-shake unreachable dependencies; `excludeFiles` should remove frontend/tests/fixtures from the function.

Sources:

- https://vercel.com/docs/functions/limitations
- https://vercel.com/docs/functions/runtimes/python
- https://vercel.com/docs/limits

## Frozen architecture after the spike

The permanent V1 architecture is **Candidate A** unless the deployed browser benchmark fails:

1. Browser corrects EXIF orientation and compresses the upload to a 3.2 MB target.
2. A single lazy OpenCV.js Web Worker performs page/grid geometry.
3. One Vercel Python function performs RapidOCR text reading only.
4. Browser fusion assigns OCR boxes to explicit cells and keeps unresolved boxes separate.
5. The same canonical JSON powers the editable worksheet and ExcelJS export.

Candidate B remains in `experiments/` and CI as a controlled benchmark. It is not imported by the production API.
