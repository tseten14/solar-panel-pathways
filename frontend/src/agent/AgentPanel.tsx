/**
 * The AI chat column on the Solar Detections page. Everything it can do to the
 * map arrives through `actions`; everything it knows about the map arrives
 * through `getMapContext`.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import AgentActivityFeed from "./AgentActivityFeed";
import AgentInput from "./AgentInput";
import AgentMessageList from "./AgentMessageList";
import { useAgentChat } from "./useAgentChat";
import type { AgentActions, AgentMapContext } from "./types";

const API_BASE = `${import.meta.env.VITE_API_URL ?? "/api"}/agent`;

export default function AgentPanel({
  getMapContext,
  actions,
  onCollapse,
}: {
  getMapContext: () => AgentMapContext;
  actions: AgentActions;
  onCollapse: () => void;
}) {
  const chat = useAgentChat(getMapContext, actions);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    fetch(`${API_BASE}/health`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled.current) setConfigured(data ? Boolean(data.configured) : false);
      })
      .catch(() => {
        if (!cancelled.current) setConfigured(false);
      });
    return () => {
      cancelled.current = true;
    };
  }, []);

  return (
    <aside
      aria-label="AI map assistant"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-card/30"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          AI Agent
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={chat.clearConversation}
            disabled={chat.isStreaming || chat.messages.length === 0}
            title="Clear conversation"
            className="rounded-md border border-border/60 px-2 py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-muted/40 disabled:opacity-40"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onCollapse}
            title="Hide the agent panel"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:bg-muted/40"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {configured === false && (
        <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 font-mono text-[10px] leading-relaxed text-amber-100">
          The agent needs OPENAI_API_KEY in the repo-root .env — add it and restart the
          backend.
        </div>
      )}

      <AgentActivityFeed activity={chat.activity} />

      <AgentMessageList
        messages={chat.messages}
        streamingText={chat.streamingText}
        progressText={chat.progressText}
        pendingConfirmation={chat.pendingConfirmation}
        isStreaming={chat.isStreaming}
        onConfirm={(id) => void chat.confirmAction(id, true)}
        onReject={(id) => void chat.confirmAction(id, false)}
        onSuggest={(text) => void chat.sendMessage(text)}
      />

      <AgentInput
        disabled={Boolean(chat.pendingConfirmation)}
        isStreaming={chat.isStreaming}
        onSend={(text) => void chat.sendMessage(text)}
        onStop={() => void chat.cancel()}
      />
    </aside>
  );
}
