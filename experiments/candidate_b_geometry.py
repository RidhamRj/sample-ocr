from __future__ import annotations

import io
import statistics
import time
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np
from PIL import Image


@dataclass(frozen=True)
class Segment:
    x1: float
    y1: float
    x2: float
    y2: float

    def as_dict(self) -> dict[str, float]:
        return {"x1": self.x1, "y1": self.y1, "x2": self.x2, "y2": self.y2}


def _cluster(values: list[float], tolerance: float) -> list[float]:
    groups: list[list[float]] = []
    for value in sorted(values):
        if not groups or value - groups[-1][-1] > tolerance:
            groups.append([value])
        else:
            groups[-1].append(value)
    return [sum(group) / len(group) for group in groups]


def _order_quad(points: np.ndarray) -> np.ndarray:
    result = np.zeros((4, 2), dtype=np.float32)
    sums = points.sum(axis=1)
    differences = np.diff(points, axis=1).reshape(-1)
    result[0] = points[np.argmin(sums)]
    result[1] = points[np.argmin(differences)]
    result[2] = points[np.argmax(sums)]
    result[3] = points[np.argmax(differences)]
    return result


def _rectify_page(image: np.ndarray) -> tuple[np.ndarray, bool]:
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    minimum_area = image.shape[0] * image.shape[1] * 0.22
    candidates: list[tuple[float, np.ndarray]] = []
    for contour in contours:
        perimeter = cv2.arcLength(contour, True)
        approximation = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        area = cv2.contourArea(contour)
        if len(approximation) == 4 and area >= minimum_area:
            points = approximation.reshape(4, 2).astype(np.float32)
            x_min, y_min = points.min(axis=0)
            x_max, y_max = points.max(axis=0)
            edge_x = image.shape[1] * 0.06
            edge_y = image.shape[0] * 0.06
            touches_page_edges = x_min <= edge_x and y_min <= edge_y and x_max >= image.shape[1] - edge_x and y_max >= image.shape[0] - edge_y
            if touches_page_edges:
                candidates.append((area, points))
    if not candidates:
        return image, False
    _, points = max(candidates, key=lambda item: item[0])
    top_left, top_right, bottom_right, bottom_left = _order_quad(points)
    width = max(int(np.linalg.norm(top_right - top_left)), int(np.linalg.norm(bottom_right - bottom_left)))
    height = max(int(np.linalg.norm(bottom_left - top_left)), int(np.linalg.norm(bottom_right - top_right)))
    destination = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32)
    transform = cv2.getPerspectiveTransform(np.array([top_left, top_right, bottom_right, bottom_left]), destination)
    return cv2.warpPerspective(image, transform, (width, height), borderValue=(255, 255, 255)), True


def _deskew(image: np.ndarray) -> tuple[np.ndarray, float]:
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 13)
    lines = cv2.HoughLinesP(binary, 1, np.pi / 180, threshold=80, minLineLength=max(40, image.shape[1] * 0.2), maxLineGap=18)
    angles: list[float] = []
    if lines is not None:
        for x1, y1, x2, y2 in lines[:, 0]:
            angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
            normalized = angle - 90 if angle > 45 else angle + 90 if angle < -45 else angle
            if abs(normalized) <= 12:
                angles.append(float(normalized))
    angle = statistics.median(angles) if angles else 0.0
    if abs(angle) < 0.3 or abs(angle) > 8:
        return image, 0.0
    center = (image.shape[1] / 2, image.shape[0] / 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    return cv2.warpAffine(image, matrix, (image.shape[1], image.shape[0]), borderValue=(255, 255, 255)), float(angle)


def _segments(mask: np.ndarray, horizontal: bool) -> list[Segment]:
    minimum = max(30, round((mask.shape[1] if horizontal else mask.shape[0]) * 0.14))
    lines = cv2.HoughLinesP(mask, 1, np.pi / 180, threshold=35, minLineLength=minimum, maxLineGap=24)
    if lines is None:
        return []
    result: list[Segment] = []
    for raw in lines[:, 0]:
        x1, y1, x2, y2 = map(float, raw)
        is_horizontal = abs(y2 - y1) <= abs(x2 - x1)
        if is_horizontal == horizontal:
            result.append(Segment(x1, y1, x2, y2))
    return result


def _merge(segments: list[Segment], horizontal: bool, tolerance: float) -> list[Segment]:
    groups: list[dict[str, Any]] = []
    key = lambda item: (item.y1 + item.y2) / 2 if horizontal else (item.x1 + item.x2) / 2
    for segment in sorted(segments, key=key):
        axis = key(segment)
        group = next((candidate for candidate in groups if abs(candidate["axis"] - axis) <= tolerance), None)
        if group is None:
            groups.append({"axis": axis, "items": [segment]})
        else:
            group["items"].append(segment)
            group["axis"] = sum(key(item) for item in group["items"]) / len(group["items"])
    merged: list[Segment] = []
    for group in groups:
        items = group["items"]
        if horizontal:
            merged.append(Segment(min(min(i.x1, i.x2) for i in items), group["axis"], max(max(i.x1, i.x2) for i in items), group["axis"]))
        else:
            merged.append(Segment(group["axis"], min(min(i.y1, i.y2) for i in items), group["axis"], max(max(i.y1, i.y2) for i in items)))
    return merged


def _bounds(box: list[list[float]]) -> tuple[float, float, float, float]:
    xs = [point[0] for point in box]
    ys = [point[1] for point in box]
    return min(xs), min(ys), max(xs), max(ys)


def _borderless_cells(ocr_boxes: list[dict[str, Any]], width: int, height: int) -> tuple[list[dict[str, Any]], list[float], list[float]]:
    if len(ocr_boxes) < 9:
        return [], [], []
    bounds = [_bounds(item["box"]) for item in ocr_boxes]
    heights = [max(1.0, bottom - top) for _, top, _, bottom in bounds]
    widths = [max(1.0, right - left) for left, _, right, _ in bounds]
    row_centers = _cluster([(top + bottom) / 2 for _, top, _, bottom in bounds], max(8, statistics.median(heights) * 0.75))
    column_centers = _cluster([(left + right) / 2 for left, _, right, _ in bounds], max(18, statistics.median(widths) * 0.7))
    if len(row_centers) < 3 or len(column_centers) < 3 or len(column_centers) > 18:
        return [], [], []
    row_boundaries = [0, *[(row_centers[index - 1] + row_centers[index]) / 2 for index in range(1, len(row_centers))], height]
    column_boundaries = [0, *[(column_centers[index - 1] + column_centers[index]) / 2 for index in range(1, len(column_centers))], width]
    cells = []
    for row in range(len(row_boundaries) - 1):
        for column in range(len(column_boundaries) - 1):
            x, y = column_boundaries[column], row_boundaries[row]
            cells.append({"id": f"borderless-1-r{row}-c{column}", "tableId": "borderless-1", "row": row, "column": column, "rowSpan": 1, "columnSpan": 1, "x": x, "y": y, "width": column_boundaries[column + 1] - x, "height": row_boundaries[row + 1] - y})
    return cells, row_boundaries, column_boundaries


def analyze_geometry(image_bytes: bytes, ocr_boxes: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    started = time.perf_counter()
    image = np.asarray(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
    image, perspective_applied = _rectify_page(image)
    image, deskew_degrees = _deskew(image)
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 13)
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(18, image.shape[1] // 28), 1))
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(18, image.shape[0] // 28)))
    horizontal_mask = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel)
    vertical_mask = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vertical_kernel)
    horizontal_mask = cv2.dilate(horizontal_mask, cv2.getStructuringElement(cv2.MORPH_RECT, (7, 1)))
    vertical_mask = cv2.dilate(vertical_mask, cv2.getStructuringElement(cv2.MORPH_RECT, (1, 7)))
    horizontal = _merge(_segments(horizontal_mask, True), True, max(3, image.shape[0] * 0.003))
    vertical = _merge(_segments(vertical_mask, False), False, max(3, image.shape[1] * 0.003))
    rows = _cluster([(line.y1 + line.y2) / 2 for line in horizontal], max(4, image.shape[0] * 0.004))
    columns = _cluster([(line.x1 + line.x2) / 2 for line in vertical], max(4, image.shape[1] * 0.004))
    cells = []
    source = "ruled-grid"
    if len(rows) >= 2 and len(columns) >= 2 and len(rows) <= 121 and len(columns) <= 41:
        for row in range(len(rows) - 1):
            for column in range(len(columns) - 1):
                x, y = columns[column], rows[row]
                cells.append({"id": f"table-1-r{row}-c{column}", "tableId": "table-1", "row": row, "column": column, "rowSpan": 1, "columnSpan": 1, "x": x, "y": y, "width": columns[column + 1] - x, "height": rows[row + 1] - y})
    if not cells and ocr_boxes:
        cells, rows, columns = _borderless_cells(ocr_boxes, image.shape[1], image.shape[0])
        source = "borderless-ocr"
    return {"page_transform": {"sourceWidth": image.shape[1], "sourceHeight": image.shape[0], "targetWidth": image.shape[1], "targetHeight": image.shape[0], "forward": [1, 0, 0, 0, 1, 0, 0, 0, 1], "inverse": [1, 0, 0, 0, 1, 0, 0, 0, 1], "perspectiveApplied": perspective_applied, "deskewDegrees": deskew_degrees}, "table_candidates": [], "horizontal_lines": [line.as_dict() for line in horizontal], "vertical_lines": [line.as_dict() for line in vertical], "row_boundaries": rows, "column_boundaries": columns, "cell_rectangles": cells, "diagnostics": {"totalMs": round((time.perf_counter() - started) * 1000, 2), "candidate": "B", "source": source}}
