import type { GeminiInvoiceJson, PreparedInvoiceImage } from "../types/invoice";

export interface AnalyzeInvoiceInput {
  apiKey: string;
  model: string;
  image: PreparedInvoiceImage;
  ocrEvidence?: string;
  signal?: AbortSignal;
}

export async function analyzeInvoice(input: AnalyzeInvoiceInput): Promise<GeminiInvoiceJson> {
  const response = await fetch("/api/gemini-invoice", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-gemini-api-key": input.apiKey.trim(),
    },
    body: JSON.stringify({
      model: input.model,
      imageBase64: input.image.base64,
      mimeType: input.image.mimeType,
      ocrEvidence: input.ocrEvidence?.trim() || "",
    }),
    signal: input.signal,
  });

  const payload = (await response.json().catch(() => null)) as
    | (GeminiInvoiceJson & { error?: never })
    | { error?: string }
    | null;

  if (!response.ok) {
    throw new Error(payload && "error" in payload && payload.error ? payload.error : `Gemini request failed with HTTP ${response.status}.`);
  }
  if (!payload || "error" in payload) throw new Error("The server returned an invalid Gemini response.");
  return payload;
}
