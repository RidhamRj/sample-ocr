import type { PreparedInvoiceImage } from "../types/invoice";

const MAX_UPLOAD_BYTES = 2_650_000;
const INITIAL_LONG_EDGE = 3200;
const MIN_LONG_EDGE = 1600;

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The browser could not encode the invoice image."))),
      "image/jpeg",
      quality,
    );
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export async function prepareInvoiceImage(file: File): Promise<PreparedInvoiceImage> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a JPG, PNG, or WebP invoice image.");

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  const warnings: string[] = [];

  let longEdge = Math.min(INITIAL_LONG_EDGE, Math.max(originalWidth, originalHeight));
  let quality = 0.92;
  let resultBlob: Blob | null = null;
  let resultWidth = originalWidth;
  let resultHeight = originalHeight;

  while (!resultBlob || resultBlob.size > MAX_UPLOAD_BYTES) {
    const scale = Math.min(1, longEdge / Math.max(originalWidth, originalHeight));
    resultWidth = Math.max(1, Math.round(originalWidth * scale));
    resultHeight = Math.max(1, Math.round(originalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = resultWidth;
    canvas.height = resultHeight;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      bitmap.close();
      throw new Error("Canvas image processing is unavailable in this browser.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, resultWidth, resultHeight);
    resultBlob = await canvasToBlob(canvas, quality);

    if (resultBlob.size <= MAX_UPLOAD_BYTES) break;
    if (quality > 0.72) quality -= 0.08;
    else if (longEdge > MIN_LONG_EDGE) {
      longEdge = Math.max(MIN_LONG_EDGE, Math.round(longEdge * 0.84));
      quality = 0.86;
    } else break;
  }

  bitmap.close();
  if (!resultBlob || resultBlob.size > MAX_UPLOAD_BYTES) {
    throw new Error("This image remains too large after compression. Crop empty margins and try again.");
  }

  if (resultWidth < originalWidth || resultHeight < originalHeight) {
    warnings.push(`Resized from ${originalWidth}×${originalHeight} to ${resultWidth}×${resultHeight} for the API request.`);
  }
  if (resultWidth < 1500 && resultHeight < 1500) {
    warnings.push("The invoice is low resolution; small batch, expiry, and tax text may be misread.");
  }

  return {
    base64: await blobToBase64(resultBlob),
    mimeType: "image/jpeg",
    previewUrl: URL.createObjectURL(resultBlob),
    originalBytes: file.size,
    processedBytes: resultBlob.size,
    originalWidth,
    originalHeight,
    processedWidth: resultWidth,
    processedHeight: resultHeight,
    warnings,
  };
}
