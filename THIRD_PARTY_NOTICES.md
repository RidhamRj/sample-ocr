# Third-Party Notices

This project combines permissively licensed libraries. Keep this file with redistributed builds and review upstream license files when dependency versions change.

## Directly used in the production application

| Component | License | Use |
|---|---|---|
| OpenCV / OpenCV.js 4.13.0 | Apache License 2.0 | Browser-side image geometry. `scripts/fetch-opencv.mjs` downloads the official prebuilt asset during build; no OpenCV source was copied into application code |
| RapidOCR 3.8.1 | Apache License 2.0 for project code; upstream notes that OCR model copyright belongs to Baidu/PaddleOCR | CPU ONNX text detection and recognition in the Vercel Python function |
| ONNX Runtime | MIT | RapidOCR CPU inference |
| ExcelJS 4.4.x | MIT | Lazy browser-side XLSX generation |
| React / React DOM | MIT | Frontend UI |
| Vite | MIT | Frontend build tooling |
| FastAPI | MIT | Python ASGI API |
| NumPy | BSD-3-Clause | OCR image arrays and reading-order statistics |
| Pillow | HPND | Image validation, conversion, resizing and self-test image |
| opencv-python-headless | Apache License 2.0 | RapidOCR dependency compatibility; production table geometry does not import it |
| Pyclipper | MIT | RapidOCR detector dependency |
| PyYAML | MIT | RapidOCR configuration dependency |
| Shapely | BSD-3-Clause | RapidOCR geometry dependency |
| OmegaConf | BSD-3-Clause | RapidOCR configuration dependency |

Transitive dependencies retain their own copyright and license notices in the installed package distributions.

## Evaluated but not copied or shipped

- `xavctn/img2table` — MIT. Structural concepts and benchmark behavior were studied; no source code was copied and the package is not installed.
- `naptha/tesseract.js` — Apache-2.0. Evaluated only; not installed.
- `microsoft/table-transformer` — MIT. Evaluated only; no model or code is included.
- `dream-num/univer` — Apache-2.0. Evaluated only; not installed.
- Handsontable — current releases use non-commercial/evaluation or commercial terms. Rejected and not installed.

## PharmacyCare source

The OCR route was adapted from the repository owner's read-only PharmacyCare project at commit `63aa1434ffdadd59ec4b5ba648e0201b9c8f4ca7`. Exact files and excluded behavior are recorded in `docs/PHARMACYCARE_OCR_ORIGIN.md`.
