/**
 * One conversation with the SolarCycle data assistant. The server keeps no
 * session: every request carries the full transcript and the survey rows.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { parseSseChunk } from "@/agent/useAgentChat";
import type { AgentMessage } from "@/agent/types";
import type { SurveySite } from "@/lib/solarcycle";

const API_BASE = `${import.meta.env.VITE_API_URL ?? "/api"}/solarcycle-ai`;
const STORAGE_KEY = "solartrace-solarcycle-chat";
const ERROR_PREFIX = "⚠︎ ";

/** The survey in the field names the assistant's prompt describes. */
export function toAssistantRows(sites: SurveySite[]) {
  return sites.map((s) => ({
    state: s.state,
    name: s.name,
    type: s.type,
    pv_status: s.pvStatus,
    pv_raw: s.pvRaw,
    accept_lqg: s.acceptLqg,
    restrictions: s.restrictions,
    owner: s.owner,
    phone: s.phone,
    alt_contact: s.altContact,
    location: s.location,
    website: s.website,
    cost: s.cost,
    cost_per: s.costPer,
    cost_unit: s.costUnit,
    cost_per_panel: s.costPerPanel,
    call_notes: s.callNotes,
    notes: s.notes,
  }));
}

function loadMessages(): AgentMessage[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useSurveyChat(sites: SurveySite[]) {
  const [messages, setMessages] = useState<AgentMessage[]>(loadMessages);
  const [streamingText, setStreamingText] = useState("");
  const [progressText, setProgressText] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const rowsRef = useRef(toAssistantRows(sites));
  rowsRef.current = toAssistantRows(sites);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // Quota exceeded or private mode — the chat still works, it just won't persist.
    }
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const append = useCallback((role: AgentMessage["role"], content: string) => {
    if (!content.trim()) return;
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role, content: content.trim(), timestamp: Date.now() },
    ]);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      const history = [...messages, { role: "user" as const, content: trimmed }]
        .filter((m) => !m.content.startsWith(ERROR_PREFIX))
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }));
      append("user", trimmed);

      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      setProgressText("Reading the survey…");
      let reply = "";

      try {
        const res = await fetch(`${API_BASE}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history, sites: rowsRef.current }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(typeof body.detail === "string" ? body.detail : `Request failed: ${res.status}`);
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error("The server sent no response body.");

        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { events, rest } = parseSseChunk(buffer);
          buffer = rest;
          for (const { event, data } of events) {
            const parsed = JSON.parse(data) as { text?: string; message?: string };
            if (event === "assistant_delta") {
              reply += parsed.text ?? "";
              setProgressText(null);
              setStreamingText(reply);
            } else if (event === "error") {
              append("assistant", `${ERROR_PREFIX}${parsed.message ?? "The assistant hit an error."}`);
            }
          }
        }
        append("assistant", reply);
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          append("assistant", reply ? `${reply}\n\n_Stopped._` : "Stopped.");
        } else {
          append("assistant", `${ERROR_PREFIX}${(err as Error).message}`);
        }
      } finally {
        setStreamingText("");
        setProgressText(null);
        setIsStreaming(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [append, isStreaming, messages],
  );

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  const clearConversation = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setStreamingText("");
    setProgressText(null);
  }, []);

  return { messages, streamingText, progressText, isStreaming, sendMessage, cancel, clearConversation };
}
