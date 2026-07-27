from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "public" / "benchmark-fixtures"
FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
FONT = ImageFont.load_default(size=24)
SMALL = ImageFont.load_default(size=19)


def add_ocr_box(boxes: list[dict[str, Any]], draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, font: ImageFont.ImageFont, row: int, column: int) -> None:
    left, top, right, bottom = draw.textbbox(xy, text, font=font)
    boxes.append({"id": f"synthetic-{len(boxes)}", "pageNumber": 1, "text": text, "confidence": 0.99, "box": [[left, top], [right, top], [right, bottom], [left, bottom]], "readingOrder": len(boxes), "kind": "line", "expectedRow": row, "expectedColumn": column})


def save_expected(name: str, *, rows: int, columns: int, blank_cells: list[list[int]], kind: str, row_boundaries: list[int] | None = None, column_boundaries: list[int] | None = None, ocr_boxes: list[dict[str, Any]] | None = None) -> None:
    payload = {"name": name, "kind": kind, "rowBoundaries": row_boundaries or [], "columnBoundaries": column_boundaries or [], "rows": rows, "columns": columns, "cellCount": rows * columns, "blankCells": blank_cells, "ocrBoxes": ocr_boxes or []}
    (FIXTURE_DIR / f"{name}.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")


def ruled_invoice() -> None:
    image = Image.new("RGB", (1400, 920), "white")
    draw = ImageDraw.Draw(image)
    draw.text((70, 40), "DELHI PHARMA AGENCIES", fill="black", font=FONT)
    draw.text((70, 80), "Invoice DPA-1042     Date 26-07-2026", fill="black", font=SMALL)
    columns = [60, 460, 620, 790, 950, 1120, 1340]
    rows = [160, 245, 330, 415, 500, 585, 670, 755, 840]
    for x in columns: draw.line((x, rows[0], x, rows[-1]), fill="black", width=3)
    for y in rows: draw.line((columns[0], y, columns[-1], y), fill="black", width=3)
    boxes: list[dict[str, Any]] = []
    headers = ["Medicine", "Batch", "Expiry", "Qty", "Rate", "Amount"]
    for col, text in enumerate(headers):
        xy = (columns[col] + 10, rows[0] + 28); draw.text(xy, text, fill="black", font=SMALL); add_ocr_box(boxes, draw, xy, text, SMALL, 0, col)
    values = [["Paracetamol 500", "P24A", "08/27", "10", "19.50", "195.00"], ["Azithromycin 250", "AZ91", "11/27", "", "48.00", "240.00"], ["Cetirizine 10", "CZ10", "02/28", "8", "12.00", "96.00"], ["Vitamin C", "VC77", "06/27", "5", "", "150.00"], ["ORS Sachet", "OR55", "01/28", "20", "8.50", "170.00"], ["Cough Syrup", "CS11", "09/27", "4", "64.00", "256.00"], ["Antacid Gel", "AG90", "12/27", "6", "45.00", "270.00"]]
    for row, row_values in enumerate(values, start=1):
        for col, text in enumerate(row_values):
            if text:
                xy = (columns[col] + 10, rows[row] + 28); draw.text(xy, text, fill="black", font=SMALL); add_ocr_box(boxes, draw, xy, text, SMALL, row, col)
    image.save(FIXTURE_DIR / "ruled-invoice.png", optimize=True)
    save_expected("ruled-invoice", rows=len(rows) - 1, columns=len(columns) - 1, row_boundaries=rows, column_boundaries=columns, blank_cells=[[2, 4], [4, 5]], kind="ruled", ocr_boxes=boxes)


def borderless_invoice() -> None:
    image = Image.new("RGB", (1400, 900), "white"); draw = ImageDraw.Draw(image)
    draw.text((70, 45), "NORTH CITY MEDICAL DISTRIBUTORS", fill="black", font=FONT)
    xs = [70, 470, 650, 820, 980, 1160]; ys = [150, 235, 320, 405, 490, 575, 660]; boxes: list[dict[str, Any]] = []
    for col, text in enumerate(["Product", "Batch", "Expiry", "Qty", "MRP", "Net"]):
        xy = (xs[col], ys[0]); draw.text(xy, text, fill="black", font=SMALL); add_ocr_box(boxes, draw, xy, text, SMALL, 0, col)
    values = [["Dolo 650", "D650", "10/27", "12", "32.00", "300.00"], ["Pantop 40", "P440", "01/28", "10", "95.00", "720.00"], ["Becosules", "BC21", "03/28", "", "55.00", "440.00"], ["Crocin", "CR17", "05/27", "15", "28.00", "315.00"], ["Digene", "DG14", "07/27", "8", "88.00", "560.00"], ["Electral", "EL88", "12/27", "20", "24.00", "400.00"]]
    for row, row_values in enumerate(values, start=1):
        for col, text in enumerate(row_values):
            if text:
                xy = (xs[col], ys[row]); draw.text(xy, text, fill="black", font=SMALL); add_ocr_box(boxes, draw, xy, text, SMALL, row, col)
    image.save(FIXTURE_DIR / "borderless-invoice.png", optimize=True)
    save_expected("borderless-invoice", rows=len(ys), columns=len(xs), blank_cells=[[3, 4]], kind="borderless", ocr_boxes=boxes)


def skewed_invoice() -> None:
    source = Image.open(FIXTURE_DIR / "ruled-invoice.png")
    rotated = source.rotate(3.2, expand=True, fillcolor="white", resample=Image.Resampling.BICUBIC)
    canvas = Image.new("RGB", (1600, 1100), "#efefef"); canvas.paste(rotated, ((canvas.width - rotated.width) // 2, (canvas.height - rotated.height) // 2)); canvas.save(FIXTURE_DIR / "skewed-invoice.png", optimize=True)
    expected = json.loads((FIXTURE_DIR / "ruled-invoice.json").read_text(encoding="utf-8"))
    save_expected("skewed-invoice", rows=expected["rows"], columns=expected["columns"], blank_cells=expected["blankCells"], kind="skewed")


if __name__ == "__main__":
    ruled_invoice(); borderless_invoice(); skewed_invoice(); print(f"Generated fixtures in {FIXTURE_DIR}")
