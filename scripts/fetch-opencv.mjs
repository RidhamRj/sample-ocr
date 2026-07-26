import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const sourceUrl = process.env.OPENCV_JS_URL || "https://docs.opencv.org/4.13.0/opencv.js";
const destination = resolve("public/vendor/opencv.js");
const minimumExpectedBytes = 5_000_000;
try { const existing = await stat(destination); if (existing.size >= minimumExpectedBytes) { console.log(`OpenCV.js already present (${existing.size} bytes)`); process.exit(0); } } catch {}
console.log(`Fetching official OpenCV.js from ${sourceUrl}`);
const response = await fetch(sourceUrl, { redirect: "follow" });
if (!response.ok) throw new Error(`OpenCV.js download failed: ${response.status} ${response.statusText}`);
const bytes = new Uint8Array(await response.arrayBuffer());
if (bytes.byteLength < minimumExpectedBytes) throw new Error(`OpenCV.js download was unexpectedly small (${bytes.byteLength} bytes)`);
const header = new TextDecoder().decode(bytes.slice(0, 500));
if (!header.includes("OpenCV") && !header.includes("Module")) throw new Error("Downloaded payload does not look like OpenCV.js");
await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, bytes); console.log(`Saved ${destination} (${bytes.byteLength} bytes)`);
