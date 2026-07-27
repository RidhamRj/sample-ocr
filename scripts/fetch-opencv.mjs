import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const sourceUrl = process.env.OPENCV_JS_URL || "https://docs.opencv.org/4.10.0/opencv.js";
const destination = resolve("public/vendor/opencv.js");
const minimumExpectedBytes = 750_000;

try {
  const existing = await stat(destination);
  if (existing.size >= minimumExpectedBytes) {
    console.log(`OpenCV.js already present (${existing.size} bytes)`);
    process.exit(0);
  }
} catch {
  // Download below.
}

console.log(`Fetching official OpenCV.js from ${sourceUrl}`);
const response = await fetch(sourceUrl, { redirect: "follow" });
if (!response.ok) throw new Error(`OpenCV.js download failed: ${response.status} ${response.statusText}`);
const contentType = response.headers.get("content-type") || "";
const bytes = new Uint8Array(await response.arrayBuffer());
if (bytes.byteLength < minimumExpectedBytes) {
  throw new Error(`OpenCV.js download was unexpectedly small (${bytes.byteLength} bytes)`);
}
const sample = new TextDecoder().decode(bytes.slice(0, 20_000)).toLowerCase();
if (!contentType.includes("javascript") && !sample.includes("opencv") && !sample.includes("module")) {
  throw new Error(`Downloaded payload does not look like JavaScript (${contentType || "unknown content type"})`);
}
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, bytes);
console.log(`Saved ${destination} (${bytes.byteLength} bytes, ${contentType || "unknown content type"})`);
