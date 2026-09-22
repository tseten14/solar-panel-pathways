/**
 * One conversation with the SolarCycle data assistant. The server keeps no
 * session and holds its own copy of the survey: every request carries only
 * the transcript.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { parseSseChunk } from "@/agent/useAgentChat";
import type { AgentMessage } from "@/agent/types";

const API_BASE = `${import.meta.env.VITE_API_URL ?? "/api"}/solarcycle-ai`;
const STORAGE_KEY = "solartrace-solarcycle-chat";
const ERROR_PREFIX = "⚠︎ ";

function loadMessages(): AgentMessage[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useSurveyChat() {
  const [messages, setMessages] = useState<AgentMessage[]>(loadMessages);
  const [streamingText, setStreamingText] = useState("");
  const [progressText, setProgressText] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

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
          body: JSON.stringify({ messages: history }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            typeof body.detail === "string"
              ? body.detail
              : `The assistant is unavailable right now (error ${res.status}).`,
          );
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
