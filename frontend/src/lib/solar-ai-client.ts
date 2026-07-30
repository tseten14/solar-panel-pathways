import type { SolarAiFact } from "@/lib/solar-ai-context";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";
const REQUEST_TIMEOUT_MS = 60_000;

export interface SolarAiCitation {
  id: string;
  label: string;
  url: string;
  domain: string;
  claim: string;
}

export interface SolarAiLine {
  text: string;
  refs: string[];
  citations: SolarAiCitation[];
}

export interface SolarAiSection {
  heading: string;
  lines: SolarAiLine[];
}

export interface SolarAiResponse {
  type: string;
  title: string;
  sections: SolarAiSection[];
  sources: SolarAiCitation[];
  confidence: "high" | "medium" | "low";
  disclaimer: string;
  suggested_follow_ups: string[];
}

export async function solarAiAnalyze(
  body: { action?: string; question?: string; fact_ledger: SolarAiFact[] },
): Promise<SolarAiResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/solar-ai/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: body.action,
        question: body.question,
        context: { fact_ledger: body.fact_ledger },
      }),
      signal: controller.signal,
    });
    if (res.status === 404) {
      throw new Error("Solar AI endpoint not found — is the backend running the latest version?");
    }
    if (res.status === 503) {
      throw new Error("Solar AI is not configured — set OPENAI_API_KEY on the API server.");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || body.error || `Solar AI request failed: ${res.status}`);
    }
    return (await res.json()) as SolarAiResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}
