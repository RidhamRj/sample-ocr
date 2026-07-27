import type { OcrBox } from "../types/canonical";

interface ApiTextLine { id?: string; text: string; confidence: number; box: Array<[number, number]>; readingOrder: number; kind?: "word" | "line"; }
interface ApiPage { pageNumber: number; width: number; height: number; words?: ApiTextLine[]; textLines?: ApiTextLine[]; diagnostics?: Record<string, unknown>; }
export interface OcrResponse { pages: ApiPage[]; processingTimeMs: number; ocrProcessingTimeMs: number; modelInformation: Record<string, unknown>; errors: Array<Record<string, unknown>>; }

export async function recognizeImage(blob: Blob, fileName: string, signal?: AbortSignal): Promise<OcrResponse> {
  const form = new FormData(); form.append("files", blob, fileName); form.append("page_numbers", "[1]");
  const apiKey = import.meta.env.VITE_OCR_API_KEY as string | undefined;
  const response = await fetch("/api/v1/recognize", { method: "POST", body: form, headers: apiKey ? { "x-api-key": apiKey } : undefined, signal });
  if (!response.ok) { const detail = await response.json().catch(() => ({ detail: response.statusText })); throw new Error(typeof detail.detail === "string" ? detail.detail : JSON.stringify(detail.detail ?? detail)); }
  return response.json() as Promise<OcrResponse>;
}

export function flattenOcr(response: OcrResponse): OcrBox[] {
  return response.pages.flatMap((page) => {
    const items = page.words?.length ? page.words : page.textLines ?? [];
    return items.map((item, index) => ({ id: item.id ?? `p${page.pageNumber}-ocr-${index}`, pageNumber: page.pageNumber, text: item.text, confidence: item.confidence, box: item.box, readingOrder: item.readingOrder, kind: item.kind ?? "line" }));
  });
}
