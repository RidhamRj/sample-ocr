from __future__ import annotations

import io
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from api import ocr_core


class FakeEngine:
    def __call__(self, _pixels):
        return [
            ([[110, 40], [190, 40], [190, 65], [110, 65]], "second", 0.91),
            ([[10, 40], [80, 40], [80, 65], [10, 65]], "first", 0.95),
        ]


class OcrCoreTests(unittest.TestCase):
    def test_normalizes_numpy_like_boxes_and_reading_order(self):
        parsed = ocr_core._extract_lines(FakeEngine()(None))
        self.assertEqual([line["text"] for line in parsed], ["first", "second"])
        self.assertEqual([line["readingOrder"] for line in parsed], [0, 1])
        self.assertEqual(parsed[0]["id"], "ocr-0")

    def test_recognize_returns_json_only_contract(self):
        image = Image.new("RGB", (400, 200), "white")
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        client = TestClient(ocr_core.app)
        with patch.object(ocr_core, "_engine", return_value=FakeEngine()):
            response = client.post("/api/v1/recognize", files={"files": ("invoice.png", buffer.getvalue(), "image/png")}, data={"page_numbers": "[1]"})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["pages"][0]["width"], 400)
        self.assertEqual(payload["pages"][0]["words"][0]["text"], "first")
        self.assertNotIn("image", payload["pages"][0])
        self.assertNotIn("base64", str(payload).lower())

    def test_rejects_payload_over_bound_before_ocr(self):
        client = TestClient(ocr_core.app)
        oversized = b"x" * (ocr_core.MAX_IMAGE_BYTES + 1)
        response = client.post("/api/v1/recognize", files={"files": ("too-large.png", oversized, "image/png")}, data={"page_numbers": "[1]"})
        self.assertEqual(response.status_code, 413)


if __name__ == "__main__":
    unittest.main()
