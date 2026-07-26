import type { BrowserGeometryResult } from "../types/canonical";

interface WorkerResultMessage { type: "result" | "error" | "progress"; requestId: string; result?: BrowserGeometryResult; error?: string; stage?: string; progress?: number; }
export interface GeometryProgress { stage: string; progress: number; }

class GeometryWorkerClient {
  private worker: Worker | null = null;
  private activeRequestId: string | null = null;
  private getWorker(): Worker { if (!this.worker) this.worker = new Worker("/opencv-worker.js"); return this.worker; }
  cancel(): void { this.worker?.terminate(); this.worker = null; this.activeRequestId = null; }
  analyze(imageBitmap: ImageBitmap, onProgress?: (progress: GeometryProgress) => void, signal?: AbortSignal): Promise<BrowserGeometryResult> {
    const worker = this.getWorker(); const requestId = crypto.randomUUID(); this.activeRequestId = requestId;
    return new Promise((resolve, reject) => {
      const cleanup = () => { worker.removeEventListener("message", onMessage); worker.removeEventListener("error", onError); signal?.removeEventListener("abort", onAbort); if (this.activeRequestId === requestId) this.activeRequestId = null; };
      const onAbort = () => { cleanup(); this.cancel(); reject(new DOMException("Geometry processing cancelled", "AbortError")); };
      const onError = (event: ErrorEvent) => { cleanup(); reject(new Error(event.message || "OpenCV worker failed")); };
      const onMessage = (event: MessageEvent<WorkerResultMessage>) => {
        const message = event.data; if (message.requestId !== requestId) return;
        if (message.type === "progress") { onProgress?.({ stage: message.stage ?? "geometry", progress: message.progress ?? 0 }); return; }
        cleanup();
        if (message.type === "error") { this.cancel(); reject(new Error(message.error ?? "OpenCV worker failed")); }
        else if (message.result) resolve(message.result); else reject(new Error("OpenCV worker returned no geometry"));
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true }); worker.addEventListener("message", onMessage); worker.addEventListener("error", onError);
      worker.postMessage({ type: "analyze", requestId, imageBitmap, opencvUrl: import.meta.env.VITE_OPENCV_URL || "/vendor/opencv.js" }, [imageBitmap]);
    });
  }
}
export const geometryWorker = new GeometryWorkerClient();
