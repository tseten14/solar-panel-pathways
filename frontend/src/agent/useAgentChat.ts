/**
 * Drives one agent conversation: streams the reply over SSE, runs whatever the
 * agent asks the map to do, and hands scan results back so it can carry on.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { clearStoredChat, loadStoredChat, saveStoredChat } from "./agentStorage";
import type {
  AgentActions,
  AgentActivityStep,
  AgentConfirmation,
  AgentMapContext,
  AgentMessage,
  ClientToolOutcome,
} from "./types";

const API_BASE = `${import.meta.env.VITE_API_URL ?? "/api"}/agent`;

/** Tools whose effects the map has to re-read from the server afterwards. */
const REFRESHING_TOOLS = new Set([
  "erase_in_circle",
  "confirm_detections",
  "reject_detections",
  "merge_detections",
  "scan_area",
  "scan_multiple_squares",
]);

interface SseEvent {
  event: string;
  data: string;
}

/** Split a raw SSE buffer into whole events, returning the incomplete tail. */
export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  const blocks = buffer.split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    if (!block.trim()) continue;
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data = line.slice(6);
    }
    if (data) events.push({ event, data });
  }
  return { events, rest };
}

export function normalizeConfirmation(raw: Record<string, unknown>): AgentConfirmation {
  return {
    actionId: String(raw.action_id ?? ""),
    tool: String(raw.tool ?? ""),
    summary: String(raw.summary ?? "Confirm this action?"),
    impact: (raw.impact as Record<string, unknown>) ?? undefined,
  };
}

async function readErrorMessage(res: Response): Promise<string> {
  const raw = await res.text();
  try {
    const parsed = JSON.parse(raw) as { detail?: unknown };
    if (typeof parsed?.detail === "string") return parsed.detail;
  } catch {
    // Not JSON — fall through.
  }
  return raw || `Request failed: ${res.status}`;
}

export function useAgentChat(
  getMapContext: () => AgentMapContext,
  actions: AgentActions,
) {
  const stored = useRef(loadStoredChat());
  const [sessionId, setSessionId] = useState(() => stored.current?.sessionId ?? crypto.randomUUID());
  const [messages, setMessages] = useState<AgentMessage[]>(() => stored.current?.messages ?? []);
  const [streamingText, setStreamingText] = useState("");
  const [progressText, setProgressText] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activity, setActivity] = useState<AgentActivityStep[]>([]);
  const [pendingConfirmation, setPendingConfirmation] = useState<AgentConfirmation | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const clientOutcomeRef = useRef<ClientToolOutcome | null>(null);
  // The map actions change identity on every page render; a ref keeps the
  // streaming callbacks stable so an in-flight turn is never torn down.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const contextRef = useRef(getMapContext);
  contextRef.current = getMapContext;

  useEffect(() => {
    saveStoredChat({ sessionId, messages });
  }, [sessionId, messages]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const appendAssistant = useCallback((content: string) => {
    if (!content.trim()) return;
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "assistant", content: content.trim(), timestamp: Date.now() },
    ]);
  }, []);

  /** Carry out one map action the agent asked for. */
  const runClientAction = useCallback(
    async (payload: Record<string, unknown>): Promise<ClientToolOutcome | null> => {
      const act = actionsRef.current;
      const action = String(payload.action ?? "");
      const params = (payload.params ?? {}) as Record<string, unknown>;

      switch (action) {
        case "fly_to":
          act.flyTo(Number(params.lat), Number(params.lng), params.zoom as number | undefined);
          return null;
        case "set_scan_square":
          act.setScanSquare(params.center as [number, number], params.radius_m as number | undefined);
          return null;
        case "add_scan_squares":
          act.addScanSquares((params.squares ?? []) as Array<[number, number]>);
          return null;
        case "clear_scan_squares":
          act.clearScanSquares();
          return null;
        case "set_scan_radius":
          act.setScanRadius(Number(params.radius_m));
          return null;
        case "set_map_tool":
          act.setMapTool(params.tool as Parameters<AgentActions["setMapTool"]>[0]);
          return null;
        case "focus_detection":
          act.focusDetection(Number(params.detection_id));
          return null;

        case "run_scan": {
          const outcome = await act.runScan(
            params.center as [number, number],
            Number(params.radius_m),
            setProgressText,
          );
          setProgressText(null);
          await act.refresh();
          return outcome;
        }
        case "run_scan_multiple": {
          const squares = ((params.squares ?? []) as Array<{ center: [number, number]; radius_m: number }>).map(
            (sq) => ({ center: sq.center, radiusM: Number(sq.radius_m) }),
          );
          const outcome = await act.runScanMultiple(squares, setProgressText);
          setProgressText(null);
          await act.refresh();
          return outcome;
        }
        default:
          return null;
      }
    },
    [],
  );

  const postContinue = useCallback(
    async (toolCallId: string, result: ClientToolOutcome, signal?: AbortSignal) => {
      const res = await fetch(`${API_BASE}/continue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          tool_call_id: toolCallId,
          map_context: contextRef.current(),
          result,
        }),
        signal,
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      return res;
    },
    [sessionId],
  );

  const consumeStream = useCallback(
    async (response: Response): Promise<void> => {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("The server sent no response body.");

      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";
      let awaitingToolCallId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSseChunk(buffer);
        buffer = rest;

        for (const { event, data } of events) {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(data) as Record<string, unknown>;
          } catch {
            continue;
          }

          switch (event) {
            case "assistant_delta":
              assistantText += (parsed.text as string) ?? "";
              setStreamingText(assistantText);
              setProgressText(null);
              break;

            case "tool_start":
              setActivity((prev) => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  tool: String(parsed.tool ?? ""),
                  label: String(parsed.label ?? parsed.tool ?? "Working"),
                  phase: "running",
                },
              ]);
              break;

            case "tool_result": {
              const ok = parsed.ok !== false;
              const detail = ok
                ? undefined
                : String((parsed.result as Record<string, unknown>)?.error ?? "failed");
              setActivity((prev) =>
                prev.map((step, i) =>
                  i === prev.length - 1
                    ? { ...step, phase: ok ? "done" : "error", detail }
                    : step,
                ),
              );
              if (REFRESHING_TOOLS.has(String(parsed.tool ?? ""))) {
                void actionsRef.current.refresh();
              }
              break;
            }

            case "client_action": {
              const outcome = await runClientAction(parsed);
              if (outcome) clientOutcomeRef.current = outcome;
              break;
            }

            case "awaiting_client":
              awaitingToolCallId = String(parsed.tool_call_id ?? "");
              break;

            case "confirmation_required":
              setPendingConfirmation(
                normalizeConfirmation(parsed.confirmation as Record<string, unknown>),
              );
              break;

            case "error":
              appendAssistant(`⚠︎ ${(parsed.message as string) ?? "The agent hit an error."}`);
              assistantText = "";
              setStreamingText("");
              break;

            case "done": {
              if (awaitingToolCallId) {
                // Flush whatever the agent said before handing off, so the
                // "scanning now…" line isn't lost when the stream resumes.
                if (assistantText.trim()) appendAssistant(assistantText);
                assistantText = "";
                setStreamingText("");

                const outcome = clientOutcomeRef.current ?? {
                  ok: false,
                  error: "The map action did not run.",
                };
                clientOutcomeRef.current = null;
                const next = await postContinue(
                  awaitingToolCallId,
                  outcome,
                  abortRef.current?.signal,
                );
                awaitingToolCallId = null;
                await consumeStream(next);
                return;
              }
              if (assistantText.trim()) appendAssistant(assistantText);
              assistantText = "";
              setStreamingText("");
              break;
            }

            default:
              break;
          }
        }
      }
    },
    [appendAssistant, postContinue, runClientAction],
  );

  /** Open a stream and drain it, sharing one set of guards for every entry point. */
  const runStream = useCallback(
    async (open: (signal: AbortSignal) => Promise<Response>) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      clientOutcomeRef.current = null;
      setIsStreaming(true);
      setStreamingText("");

      try {
        const res = await open(controller.signal);
        if (!res.ok) throw new Error(await readErrorMessage(res));
        await consumeStream(res);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          appendAssistant(`⚠︎ ${(err as Error).message}`);
        }
      } finally {
        setIsStreaming(false);
        setProgressText(null);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [appendAssistant, consumeStream],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", content: trimmed, timestamp: Date.now() },
      ]);
      setActivity([]);
      setPendingConfirmation(null);
      setProgressText("Thinking…");

      await runStream((signal) =>
        fetch(`${API_BASE}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            message: trimmed,
            map_context: contextRef.current(),
          }),
          signal,
        }),
      );
    },
    [isStreaming, runStream, sessionId],
  );

  const confirmAction = useCallback(
    async (actionId: string, approved: boolean) => {
      setPendingConfirmation(null);
      setProgressText(approved ? "Working…" : null);
      await runStream((signal) =>
        fetch(`${API_BASE}/confirm/${actionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approved, map_context: contextRef.current() }),
          signal,
        }),
      );
    },
    [runStream],
  );

  const cancel = useCallback(async () => {
    abortRef.current?.abort();
    await fetch(`${API_BASE}/cancel/${sessionId}`, { method: "POST" }).catch(() => {});
    setIsStreaming(false);
    setStreamingText("");
    setProgressText(null);
    appendAssistant("Stopped.");
  }, [appendAssistant, sessionId]);

  const clearConversation = useCallback(() => {
    const previous = sessionId;
    abortRef.current?.abort();
    setSessionId(crypto.randomUUID());
    setMessages([]);
    setStreamingText("");
    setProgressText(null);
    setActivity([]);
    setPendingConfirmation(null);
    clearStoredChat();
    fetch(`${API_BASE}/session/${previous}`, { method: "DELETE" }).catch(() => {});
  }, [sessionId]);

  return {
    messages,
    streamingText,
    progressText,
    isStreaming,
    activity,
    pendingConfirmation,
    sendMessage,
    confirmAction,
    cancel,
    clearConversation,
  };
}
