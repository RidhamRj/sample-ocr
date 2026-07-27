from __future__ import annotations

import json
import os
import resource
import statistics
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from experiments.candidate_b_geometry import analyze_geometry  # noqa: E402

FIXTURES = ROOT / "public" / "benchmark-fixtures"
RESULTS = ROOT / "benchmarks" / "results"
RESULTS.mkdir(parents=True, exist_ok=True)


def count_accuracy(expected: int, actual: int) -> float:
    return 1.0 if expected == actual else min(expected, actual) / max(expected, actual, 1)


def box_bounds(box):
    xs=[point[0] for point in box]; ys=[point[1] for point in box]; return min(xs),min(ys),max(xs),max(ys)


def placement_accuracy(ocr_boxes: list[dict[str, Any]], cells: list[dict[str, Any]]) -> float | None:
    scored=correct=0
    for item in ocr_boxes:
        if item.get("expectedRow") is None or item.get("expectedColumn") is None: continue
        left,top,right,bottom=box_bounds(item["box"]); x=(left+right)/2; y=(top+bottom)/2
        containing=next((cell for cell in cells if cell["x"]<=x<=cell["x"]+cell["width"] and cell["y"]<=y<=cell["y"]+cell["height"]),None)
        scored+=1; correct+=int(bool(containing and containing["row"]==item["expectedRow"] and containing["column"]==item["expectedColumn"]))
    return correct/scored if scored else None


def main() -> None:
    cases=[]; peak_before=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    for image_path in sorted(FIXTURES.glob("*.png")):
        expected=json.loads(image_path.with_suffix(".json").read_text()); image_bytes=image_path.read_bytes(); timings=[]; result=None
        for _ in range(3):
            started=time.perf_counter(); result=analyze_geometry(image_bytes, expected.get("ocrBoxes",[])); timings.append((time.perf_counter()-started)*1000)
        cells=result["cell_rectangles"]; detected_rows=max((cell["row"]+cell.get("rowSpan",1) for cell in cells),default=0); detected_columns=max((cell["column"]+cell.get("columnSpan",1) for cell in cells),default=0); placement=placement_accuracy(expected.get("ocrBoxes",[]),cells)
        cases.append({"fixture":image_path.name,"kind":expected["kind"],"imageBytes":len(image_bytes),"coldOrFirstRunMs":round(timings[0],2),"warmMedianMs":round(statistics.median(timings[1:]),2),"rowAccuracy":round(count_accuracy(expected["rows"],detected_rows),4),"columnAccuracy":round(count_accuracy(expected["columns"],detected_columns),4),"cellCountAccuracy":round(count_accuracy(expected["cellCount"],len(cells)),4),"cellPlacementAccuracy":None if placement is None else round(placement,4),"blankCellAccuracy":1.0 if len(cells)==expected["cellCount"] else round(count_accuracy(expected["cellCount"],len(cells)),4),"detectedRows":detected_rows,"expectedRows":expected["rows"],"detectedColumns":detected_columns,"expectedColumns":expected["columns"],"detectedCells":len(cells),"expectedCells":expected["cellCount"],"diagnostics":result.get("diagnostics",{})})
    placement_values=[case["cellPlacementAccuracy"] for case in cases if case["cellPlacementAccuracy"] is not None]
    payload={"candidate":"B - Vercel Python OpenCV geometry plus shared OCR-box fallback","runtime":sys.version,"pid":os.getpid(),"cases":cases,"summary":{"medianWarmMs":round(statistics.median(case["warmMedianMs"] for case in cases),2),"meanRowAccuracy":round(statistics.mean(case["rowAccuracy"] for case in cases),4),"meanColumnAccuracy":round(statistics.mean(case["columnAccuracy"] for case in cases),4),"meanCellCountAccuracy":round(statistics.mean(case["cellCountAccuracy"] for case in cases),4),"meanCellPlacementAccuracy":round(statistics.mean(placement_values),4) if placement_values else None,"meanBlankCellAccuracy":round(statistics.mean(case["blankCellAccuracy"] for case in cases),4),"peakRssDeltaKb":max(0,resource.getrusage(resource.RUSAGE_SELF).ru_maxrss-peak_before)},"notes":["Synthetic OCR boxes are held constant for both candidates so this benchmark isolates table structure and cell assignment.","The first local run approximates cold geometry initialization; deployed RapidOCR cold start is measured separately."]}
    (RESULTS/"candidate-b.json").write_text(json.dumps(payload,indent=2)); print(json.dumps(payload,indent=2))


if __name__ == "__main__": main()
