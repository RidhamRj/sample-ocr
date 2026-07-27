import type { BrowserGeometryResult } from "../types/canonical";

interface WorkerResultMessage { type: "result" | "error" | "progress"; requestId: string; result?: BrowserGeometryResult; error?: string; stage?: string; progress?: number; }
export interface GeometryProgress { stage: string; progress: number; }

const GEOMETRY_TIMEOUT_MS = 25_000;

class GeometryWorkerClient {
  private worker: Worker | null = null;
  private activeRequestId: string | null = null;
  private getWorker(): Worker { if (!this.worker) this.worker = new Worker("/opencv-worker.js"); return this.worker; }
  cancel(): void { this.worker?.terminate(); this.worker = null; this.activeRequestId = null; }
  analyze(imageBitmap: ImageBitmap, onProgress?: (progress: GeometryProgress) => void, signal?: AbortSignal): Promise<BrowserGeometryResult> {
    const worker = this.getWorker(); const requestId = crypto.randomUUID(); this.activeRequestId = requestId;
    return new Promise((resolve, reject) => {
      let timeoutId: number | undefined;
      const cleanup = () => {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        worker.removeEventListener("messageerror", onMessageError);
        signal?.removeEventListener("abort", onAbort);
        if (this.activeRequestId === requestId) this.activeRequestId = null;
      };
      const fail = (error: Error) => { cleanup(); this.cancel(); reject(error); };
      const onAbort = () => fail(new DOMException("Geometry processing cancelled", "AbortError"));
      const onError = (event: ErrorEvent) => fail(new Error(event.message || "OpenCV worker failed"));
      const onMessageError = () => fail(new Error("OpenCV worker returned an unreadable response"));
      const onMessage = (event: MessageEvent<WorkerResultMessage>) => {
        const message = event.data; if (message.requestId !== requestId) return;
        if (message.type === "progress") {
          const stage = message.stage === "Loading OpenCV.js"
            ? "Loading OpenCV.js — first run downloads about 11 MB"
            : message.stage ?? "geometry";
          onProgress?.({ stage, progress: message.progress ?? 0 });
          return;
        }
        cleanup();
        if (message.type === "error") { this.cancel(); reject(new Error(message.error ?? "OpenCV worker failed")); }
        else if (message.result) resolve(message.result); else reject(new Error("OpenCV worker returned no geometry"));
      };
      if (signal?.aborted) return onAbort();
      timeoutId = window.setTimeout(
        () => fail(new Error("OpenCV geometry timed out after 25 seconds; continuing with OCR-based reconstruction")),
        GEOMETRY_TIMEOUT_MS,
      );
      signal?.addEventListener("abort", onAbort, { once: true });
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.addEventListener("messageerror", onMessageError);
      worker.postMessage({ type: "analyze", requestId, imageBitmap, opencvUrl: import.meta.env.VITE_OPENCV_URL || "/vendor/opencv.js?v=4.10.0" }, [imageBitmap]);
    });
  }
}
export const geometryWorker = new GeometryWorkerClient();
