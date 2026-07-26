from __future__ import annotations

import asyncio
import hmac
import io
import json
import os
import resource
import threading
import time
from importlib import metadata
from typing import Any

import numpy as np
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from PIL import Image, ImageDraw

app = FastAPI(title="sample-ocr RapidOCR", version="1.0.0")

MAX_PAGES = 1
MAX_IMAGE_BYTES = max(500_000, min(int(os.environ.get("OCR_MAX_IMAGE_BYTES", "3400000")), 3_600_000))
MAX_TOTAL_BYTES = max(MAX_IMAGE_BYTES, min(int(os.environ.get("OCR_MAX_TOTAL_BYTES", "3600000")), 3_800_000))
MAX_IMAGE_DIMENSION = max(1600, min(int(os.environ.get("OCR_MAX_IMAGE_DIMENSION", "2400")), 2800))
MAX_OCR_ITEMS = max(200, min(int(os.environ.get("OCR_MAX_ITEMS", "2500")), 4000))
MAX_TEXT_LENGTH = 500
API_KEY = (os.environ.get("OCR_API_KEY") or "").strip()

_ENGINE: Any | None = None
_ENGINE_LOAD_TIME_MS = 0
_ENGINE_LOCK = threading.Lock()
_REQUEST_LOCK = asyncio.Lock()


def _package_version(name: str, fallback: str = "unknown") -> str:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return fallback


def _require_api_key(provided: str | None) -> None:
    if API_KEY and (provided is None or not hmac.compare_digest(provided, API_KEY)):
        raise HTTPException(status_code=401, detail="Invalid OCR service key")


def _engine() -> Any:
    global _ENGINE, _ENGINE_LOAD_TIME_MS
    if _ENGINE is not None:
        return _ENGINE
    with _ENGINE_LOCK:
        if _ENGINE is not None:
            return _ENGINE
        started = time.perf_counter()
        from rapidocr import RapidOCR

        parameters = {
            "EngineConfig.onnxruntime.intra_op_num_threads": 1,
            "EngineConfig.onnxruntime.inter_op_num_threads": 1,
            "EngineConfig.onnxruntime.enable_cpu_mem_arena": False,
            "Global.max_side_len": MAX_IMAGE_DIMENSION,
            "Rec.rec_batch_num": 1,
            "Cls.cls_batch_num": 1,
        }
        try:
            _ENGINE = RapidOCR(params=parameters)
        except TypeError:
            _ENGINE = RapidOCR()
        _ENGINE_LOAD_TIME_MS = round((time.perf_counter() - started) * 1000)
        return _ENGINE


def _normalize_box(raw_box: Any) -> list[list[float]] | None:
    if hasattr(raw_box, "tolist"):
        raw_box = raw_box.tolist()
    if not isinstance(raw_box, (list, tuple)) or len(raw_box) < 4:
        return None
    points: list[list[float]] = []
    for point in raw_box:
        if hasattr(point, "tolist"):
            point = point.tolist()
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            return None
        try:
            points.append([float(point[0]), float(point[1])])
        except (TypeError, ValueError):
            return None
    return points


def _box_bounds(box: list[list[float]] | None) -> tuple[float, float, float, float] | None:
    if not box:
        return None
    xs = [point[0] for point in box]
    ys = [point[1] for point in box]
    return min(xs), min(ys), max(xs), max(ys)


def _assign_reading_order(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    heights = []
    for line in lines:
        bounds = _box_bounds(line.get("box"))
        if bounds:
            heights.append(max(bounds[3] - bounds[1], 1.0))
    median_height = float(np.median(heights)) if heights else 18.0
    row_band = max(8.0, min(median_height * 0.65, 24.0))

    def sort_key(line: dict[str, Any]) -> tuple[int, float, float]:
        bounds = _box_bounds(line.get("box"))
        if not bounds:
            return 0, 0.0, 0.0
        left, top, _, _ = bounds
        return round(top / row_band), left, top

    ordered = sorted(lines, key=sort_key)
    for order, line in enumerate(ordered):
        line["readingOrder"] = order
        line["id"] = f"ocr-{order}"
    return ordered


def _extract_lines(raw_result: Any) -> list[dict[str, Any]]:
    result = raw_result[0] if isinstance(raw_result, tuple) else raw_result
    if result is None:
        return []
    if hasattr(result, "txts") and hasattr(result, "boxes"):
        scores = getattr(result, "scores", [])
        result = list(zip(result.boxes, result.txts, scores))
    if not isinstance(result, (list, tuple)):
        return []

    parsed: list[dict[str, Any]] = []
    for item in result:
        if not isinstance(item, (list, tuple)) or len(item) < 3:
            continue
        box = _normalize_box(item[0])
        text = str(item[1] or "").strip()[:MAX_TEXT_LENGTH]
        if not text or box is None:
            continue
        try:
            confidence = max(0.0, min(float(item[2]), 1.0))
        except (TypeError, ValueError):
            confidence = 0.0
        if len(parsed) >= MAX_OCR_ITEMS:
            break
        parsed.append({"text": text, "confidence": confidence, "box": box, "readingOrder": 0, "kind": "line"})
    return _assign_reading_order(parsed)


def _prepare_image(content: bytes) -> tuple[Image.Image, np.ndarray, dict[str, Any]]:
    try:
        image = Image.open(io.BytesIO(content))
        image.load()
    except Exception as error:
        raise HTTPException(status_code=400, detail="Uploaded page is not a valid image") from error
    original_size = image.size
    image = image.convert("RGB")
    largest = max(image.size)
    resized = False
    if largest > MAX_IMAGE_DIMENSION:
        scale = MAX_IMAGE_DIMENSION / largest
        image = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
        resized = True
    return image, np.asarray(image), {"originalSize": original_size, "resized": resized}


def _memory_megabytes() -> float | None:
    try:
        usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return round(usage / 1024, 2)
    except Exception:
        return None


def _recognize_page(content: bytes, page_number: int) -> tuple[dict[str, Any], int]:
    image, pixels, preparation = _prepare_image(content)
    started = time.perf_counter()
    raw_result = _engine()(pixels)
    text_lines = _extract_lines(raw_result)
    duration_ms = round((time.perf_counter() - started) * 1000)
    return ({"pageNumber": page_number, "width": image.width, "height": image.height, "words": text_lines, "textLines": text_lines, "diagnostics": {**preparation, "wordLevelBoxes": False, "lineCount": len(text_lines), "responseItemLimit": MAX_OCR_ITEMS, "memoryPeakMb": _memory_megabytes()}}, duration_ms)


def _model_information() -> dict[str, Any]:
    return {"provider": "rapidocr", "rapidOcrVersion": _package_version("rapidocr"), "onnxRuntimeVersion": _package_version("onnxruntime"), "pipeline": "RapidOCR ONNX text detection and recognition only", "device": "cpu", "modelLoadTimeMs": _ENGINE_LOAD_TIME_MS, "tableParsing": False, "gpuRequired": False}


@app.get("/")
@app.get("/api")
def root() -> dict[str, Any]:
    return {"service": "sample-ocr RapidOCR", "status": "ok", "runtime": "rapidocr + onnxruntime", "authenticationConfigured": bool(API_KEY)}


@app.get("/health")
@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "loaded": _ENGINE is not None, "limits": {"maxPages": MAX_PAGES, "maxImageBytes": MAX_IMAGE_BYTES, "maxTotalBytes": MAX_TOTAL_BYTES, "maxImageDimension": MAX_IMAGE_DIMENSION, "maxOcrItems": MAX_OCR_ITEMS}, "modelInformation": _model_information()}


@app.get("/self-test")
@app.get("/api/self-test")
async def self_test(x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    _require_api_key(x_api_key)
    image = Image.new("RGB", (1100, 240), "white")
    ImageDraw.Draw(image).text((45, 65), "SAMPLE OCR 123", fill="black", font_size=64)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    async with _REQUEST_LOCK:
        page, duration_ms = await asyncio.to_thread(_recognize_page, buffer.getvalue(), 1)
    return {"status": "ok" if page["textLines"] else "no_text", "recognizedText": [line["text"] for line in page["textLines"]], "processingTimeMs": duration_ms, "modelInformation": _model_information()}


@app.post("/v1/recognize")
@app.post("/api/v1/recognize")
async def recognize(files: list[UploadFile] = File(...), page_numbers: str = Form("[]"), x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    _require_api_key(x_api_key)
    if not files:
        raise HTTPException(status_code=400, detail="At least one image is required")
    if len(files) > MAX_PAGES:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_PAGES} page is allowed per request")
    try:
        raw_numbers = json.loads(page_numbers)
        if not isinstance(raw_numbers, list):
            raise ValueError
        numbers = [int(value) for value in raw_numbers]
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=400, detail="page_numbers must be a JSON array of integers") from error
    if numbers and len(numbers) != len(files):
        raise HTTPException(status_code=400, detail="page_numbers length must match files")
    if not numbers:
        numbers = list(range(1, len(files) + 1))
    started = time.perf_counter()
    pages: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    total_bytes = 0
    ocr_processing_time_ms = 0
    try:
        uploaded_pages: list[tuple[int, bytes]] = []
        for index, uploaded in enumerate(files):
            content = await uploaded.read()
            if not content:
                raise HTTPException(status_code=400, detail=f"Page {index + 1} is empty")
            if len(content) > MAX_IMAGE_BYTES:
                raise HTTPException(status_code=413, detail=f"Page {index + 1} exceeds {MAX_IMAGE_BYTES} bytes")
            total_bytes += len(content)
            if total_bytes > MAX_TOTAL_BYTES:
                raise HTTPException(status_code=413, detail=f"Combined upload exceeds {MAX_TOTAL_BYTES} bytes")
            uploaded_pages.append((numbers[index], content))
        async with _REQUEST_LOCK:
            for page_number, content in uploaded_pages:
                try:
                    page, duration_ms = await asyncio.to_thread(_recognize_page, content, page_number)
                    pages.append(page)
                    ocr_processing_time_ms += duration_ms
                except HTTPException:
                    raise
                except Exception as error:
                    errors.append({"pageNumber": page_number, "code": "provider_error", "message": str(error)[:500]})
        if not pages:
            message = errors[0]["message"] if errors else "OCR produced no pages"
            raise HTTPException(status_code=500, detail={"code": "provider_error", "message": message})
        return {"pages": pages, "processingTimeMs": round((time.perf_counter() - started) * 1000), "ocrProcessingTimeMs": ocr_processing_time_ms, "uploadedBytes": total_bytes, "modelInformation": _model_information(), "errors": errors}
    finally:
        for uploaded in files:
            await uploaded.close()
