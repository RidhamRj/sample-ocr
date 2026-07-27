from __future__ import annotations

import json
import unittest
from pathlib import Path

from experiments.candidate_b_geometry import analyze_geometry

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "public" / "benchmark-fixtures"


class CandidateBGeometryTests(unittest.TestCase):
    def test_ruled_grid_materializes_all_cells(self):
        image = FIXTURES / "ruled-invoice.png"
        expected = json.loads(image.with_suffix(".json").read_text(encoding="utf-8"))
        result = analyze_geometry(image.read_bytes(), expected["ocrBoxes"])
        self.assertEqual(len(result["cell_rectangles"]), expected["cellCount"])

    def test_borderless_fallback_uses_same_ocr_boxes(self):
        image = FIXTURES / "borderless-invoice.png"
        expected = json.loads(image.with_suffix(".json").read_text(encoding="utf-8"))
        result = analyze_geometry(image.read_bytes(), expected["ocrBoxes"])
        self.assertEqual(result["diagnostics"]["source"], "borderless-ocr")
        self.assertEqual(len(result["cell_rectangles"]), expected["cellCount"])

    def test_skewed_grid_is_deskewed(self):
        image = FIXTURES / "skewed-invoice.png"
        expected = json.loads(image.with_suffix(".json").read_text(encoding="utf-8"))
        result = analyze_geometry(image.read_bytes())
        self.assertGreater(abs(result["page_transform"]["deskewDegrees"]), 2)
        self.assertEqual(len(result["cell_rectangles"]), expected["cellCount"])


if __name__ == "__main__":
    unittest.main()
