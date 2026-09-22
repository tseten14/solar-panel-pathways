/// <reference types="node" />
/**
 * The SolarCycle survey assistant, as a plain Web `Request -> Response` handler.
 *
 * Runs as a Vercel Function in production and inside the Vite dev server
 * locally, so it needs no separate backend. It reads the survey CSV bundled
 * with the site rather than trusting rows sent by the browser.
 *
 * Replies stream as Server-Sent Events: `assistant_delta` chunks, optional
 * `error`, then `done`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSurvey, toAssistantRows, type SurveySite } from "../../src/lib/solarcycle.js";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
// Resolved from this file so Vercel's file tracing bundles the CSV with the
// function; the working directory there is not the frontend folder.
const SURVEY_CANDIDATES = [
  fileURLToPath(new URL("../../src/data/solarcycle-landfill-survey.csv", import.meta.url)),
  path.join(process.cwd(), "src/data/solarcycle-landfill-survey.csv"),
  path.join(process.cwd(), "frontend/src/data/solarcycle-landfill-survey.csv"),
];
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_COMPLETION_TOKENS = 1_500;

const SYSTEM_PROMPT = `You are the SolarCycle data assistant. You answer questions about \
SolarCycle's landfill survey: which landfills in Arizona, Nevada, Texas and New Mexico \
accept end-of-life solar (PV) panels, their restrictions, contacts, and disposal prices.

The full survey is given below as JSON, one object per landfill row. Field meanings:
- pv_status: "accepts", "declines", "unknown" (asked, no clear answer), or \
"not_surveyed" (on the call list, no answer recorded yet). pv_raw is the survey's own wording.
- cost is the quoted price as of July 2024, per \`cost_per\` \`cost_unit\` (2000 lbs = one ton).
- cost_per_panel is SolarCycle's per-panel estimate derived from that price.
- restrictions, notes and call_notes are free text from the callers.
- Missing fields were not recorded.

Rules:
- Use ONLY this survey. If it does not contain the answer, say so plainly and, if useful, \
say what is recorded instead. Never guess prices, policies or contacts.
- Count carefully when asked "how many"; the summary block has the headline totals.
- Name the specific landfills (with state) behind any claim, and quote prices exactly as \
recorded, noting they are July 2024 quotes.
- Beatty Facility (NV) appears twice: once for non-hazardous and once for hazardous waste.
- Decline requests unrelated to the survey.
- Keep answers short: a sentence or two, then a short list or table only when it helps. \
Use Markdown.`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatDeps {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  sites?: SurveySite[];
}

let cachedSites: SurveySite[] | null = null;

function loadSites(): SurveySite[] {
  if (cachedSites) return cachedSites;
  const file = SURVEY_CANDIDATES.find((p) => existsSync(p));
  if (!file) throw new Error(`Survey CSV not found; looked in ${SURVEY_CANDIDATES.join(", ")}`);
  cachedSites = parseSurvey(readFileSync(file, "utf8"));
  return cachedSites;
}

export function summariseSurvey(sites: SurveySite[]) {
  const byState: Record<string, Record<string, number>> = {};
  for (const s of sites) {
    const row = (byState[s.state] ??= { total: 0 });
    row.total++;
    row[s.pvStatus] = (row[s.pvStatus] ?? 0) + 1;
  }
  const priced = sites
    .filter((s) => s.costPerPanel != null && s.costPerPanel > 0)
    .map((s) => s.costPerPanel!)
    .sort((a, b) => a - b);
  return {
    rows: sites.length,
    by_state: byState,
    priced_sites: priced.length,
    cheapest_per_panel: priced[0] ?? null,
    most_expensive_per_panel: priced[priced.length - 1] ?? null,
  };
}

export function buildSystemPrompt(sites: SurveySite[]): string {
  const rows = toAssistantRows(sites).map((r) =>
    Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== "")),
  );
  return `${SYSTEM_PROMPT}\n\nSURVEY SUMMARY:\n${JSON.stringify(summariseSurvey(sites))}\n\nSURVEY ROWS (JSON):\n${JSON.stringify(rows)}`;
}

/** Keeps only well-formed turns, newest last, within the size limits. */
export function sanitiseMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw)) return null;
  const messages = raw
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim() !== "",
    )
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
  return messages.length && messages[messages.length - 1].role === "user" ? messages : null;
}

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function model(deps: ChatDeps): string {
  return deps.model ?? (process.env.SOLARCYCLE_AI_MODEL || process.env.OPENAI_MODEL || "gpt-5.6-sol");
}

export function handleHealth(deps: ChatDeps = {}): Response {
  const apiKey = deps.apiKey ?? process.env.OPENAI_API_KEY;
  let surveyRows: number | null = null;
  try {
    surveyRows = (deps.sites ?? loadSites()).length;
  } catch (err) {
    console.error("solarcycle survey unavailable:", err);
  }
  return json({ configured: Boolean(apiKey?.trim()) && surveyRows !== null, model: model(deps), surveyRows });
}

async function openAiError(res: Response): Promise<string> {
  if (res.status === 429) return "The AI service is busy right now. Wait a moment and try again.";
  if (res.status === 401) return "The AI service rejected the server's API key.";
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return `The AI service returned an error (${res.status})${body.error?.message ? `: ${body.error.message}` : ""}.`;
}

export async function handleChat(request: Request, deps: ChatDeps = {}): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { messages?: unknown } | null;
  const messages = sanitiseMessages(body?.messages);
  if (!messages) return json({ detail: "Send at least one user message." }, 422);

  const apiKey = (deps.apiKey ?? process.env.OPENAI_API_KEY)?.trim();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(sse(event, data)));
      try {
        if (!apiKey) {
          send("error", { message: "The assistant is not set up yet: OPENAI_API_KEY is missing on the server." });
          return;
        }
        const res = await fetchImpl(OPENAI_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: model(deps),
            messages: [{ role: "system", content: buildSystemPrompt(deps.sites ?? loadSites()) }, ...messages],
            max_completion_tokens: MAX_COMPLETION_TOKENS,
            stream: true,
          }),
          signal: request.signal,
        });
        if (!res.ok || !res.body) {
          send("error", { message: await openAiError(res) });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const blob = line.slice(6).trim();
            if (blob === "[DONE]") continue;
            try {
              const text = JSON.parse(blob).choices?.[0]?.delta?.content;
              if (text) send("assistant_delta", { text });
            } catch {
              // A partial or keep-alive line; the next chunk completes it.
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error("solarcycle assistant failed:", err);
          send("error", { message: "The assistant hit a server error. Try again in a moment." });
        }
      } finally {
        send("done", {});
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
