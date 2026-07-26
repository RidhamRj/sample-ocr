export interface PreparedImage { uploadBlob: Blob; previewUrl: string; originalBytes: number; processedBytes: number; originalWidth: number; originalHeight: number; processedWidth: number; processedHeight: number; mimeType: string; warnings: string[]; }
export interface ImagePreparationOptions { maxDimension?: number; targetBytes?: number; minimumReadableDimension?: number; }

const canvasToBlob = async (canvas: OffscreenCanvas | HTMLCanvasElement, type: string, quality?: number): Promise<Blob> => {
  if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) return canvas.convertToBlob({ type, quality });
  return new Promise<Blob>((resolve, reject) => (canvas as HTMLCanvasElement).toBlob((blob) => blob ? resolve(blob) : reject(new Error("Image encoding failed")), type, quality));
};
const makeCanvas = (width: number, height: number): OffscreenCanvas | HTMLCanvasElement => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; return canvas;
};

export async function prepareImageForOcr(file: File, options: ImagePreparationOptions = {}): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) throw new Error("Only image files are supported in V1");
  const maxDimension = options.maxDimension ?? 2400; const targetBytes = options.targetBytes ?? 3_200_000; const minimumReadableDimension = options.minimumReadableDimension ?? 1500; const warnings: string[] = [];
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const originalWidth = bitmap.width; const originalHeight = bitmap.height; const firstScale = Math.min(1, maxDimension / Math.max(originalWidth, originalHeight));
  let width = Math.max(1, Math.round(originalWidth * firstScale)); let height = Math.max(1, Math.round(originalHeight * firstScale));
  const render = async (nextWidth: number, nextHeight: number, mimeType: string, quality?: number) => {
    const canvas = makeCanvas(nextWidth, nextHeight); const context = canvas.getContext("2d", { alpha: false }); if (!context) throw new Error("Browser canvas is unavailable");
    context.fillStyle = "#fff"; context.fillRect(0, 0, nextWidth, nextHeight); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high"; context.drawImage(bitmap, 0, 0, nextWidth, nextHeight);
    return canvasToBlob(canvas, mimeType, quality);
  };
  let mimeType = file.type === "image/png" && file.size <= targetBytes ? "image/png" : "image/jpeg"; let quality = mimeType === "image/jpeg" ? 0.9 : undefined; let blob = await render(width, height, mimeType, quality);
  if (blob.size > targetBytes && mimeType === "image/png") { mimeType = "image/jpeg"; quality = 0.92; warnings.push("PNG exceeded the safe upload target; a high-quality JPEG copy was created for OCR."); blob = await render(width, height, mimeType, quality); }
  while (blob.size > targetBytes && quality !== undefined && quality > 0.72) { quality = Math.max(0.72, quality - 0.06); blob = await render(width, height, mimeType, quality); }
  while (blob.size > targetBytes && Math.max(width, height) > minimumReadableDimension) { const scale = Math.max(0.86, Math.sqrt(targetBytes / blob.size) * 0.97); const largest = Math.max(minimumReadableDimension, Math.round(Math.max(width, height) * scale)); const dimensionScale = largest / Math.max(width, height); width = Math.round(width * dimensionScale); height = Math.round(height * dimensionScale); blob = await render(width, height, mimeType, quality); }
  bitmap.close();
  if (blob.size > targetBytes) warnings.push("The image remains above the preferred 3.2 MB target because further shrinking could make small text unreadable.");
  if (firstScale < 0.7) warnings.push("The original image was very large; verify small text in the preview.");
  return { uploadBlob: blob, previewUrl: URL.createObjectURL(blob), originalBytes: file.size, processedBytes: blob.size, originalWidth, originalHeight, processedWidth: width, processedHeight: height, mimeType, warnings };
}
