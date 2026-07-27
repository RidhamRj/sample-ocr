import type {
  GeminiInvoiceJson,
  GeminiServiceStatus,
  PreparedInvoiceImage,
} from "../types/invoice";

export interface AnalyzeInvoiceInput {
  apiKey?: string;
  model: string;
  image: PreparedInvoiceImage;
  ocrEvidence?: string;
  signal?: AbortSignal;
}

function extractError(payload: unknown): string | null {
  return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : null;
}

export async function getGeminiServiceStatus(signal?: AbortSignal): Promise<GeminiServiceStatus> {
  const response = await fetch("/api/gemini-invoice", {
    method: "GET",
    headers: { accept: "application/json" },
    signal,
  });
  const payload: unknown = await response.json().catch(() => null);
  const errorMessage = extractError(payload);
  if (!response.ok || !payload || typeof payload !== "object" || errorMessage) {
    throw new Error(errorMessage || `Gemini service check failed with HTTP ${response.status}.`);
  }
  return payload as GeminiServiceStatus;
}

export async function analyzeInvoice(input: AnalyzeInvoiceInput): Promise<GeminiInvoiceJson> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (input.apiKey?.trim()) headers["x-gemini-api-key"] = input.apiKey.trim();

  const response = await fetch("/api/gemini-invoice", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: input.model,
      imageBase64: input.image.base64,
      mimeType: input.image.mimeType,
      ocrEvidence: input.ocrEvidence?.trim() || "",
    }),
    signal: input.signal,
  });

  const payload: unknown = await response.json().catch(() => null);
  const errorMessage = extractError(payload);

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error(errorMessage || "Gemini free-tier quota is currently exhausted. Wait for the quota window to reset and retry.");
    }
    throw new Error(errorMessage || `Gemini request failed with HTTP ${response.status}.`);
  }
  if (!payload || typeof payload !== "object" || errorMessage) {
    throw new Error("The server returned an invalid Gemini response.");
  }
  return payload as GeminiInvoiceJson;
}
