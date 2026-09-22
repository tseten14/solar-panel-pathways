/**
 * The chat column on the SolarCycle Data page. Same look as the map agent, but
 * it only answers questions — it reads the survey and changes nothing.
 */
import { useEffect, useState } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import AgentInput from "@/agent/AgentInput";
import AgentMessageList from "@/agent/AgentMessageList";
import { useSurveyChat } from "./useSurveyChat";

const API_BASE = `${import.meta.env.VITE_API_URL ?? "/api"}/solarcycle-ai`;

export const SURVEY_PROMPTS = [
  "Which landfills in Arizona accept solar panels?",
  "What's the cheapest place to dispose of panels?",
  "Which sites need TCLP testing?",
  "Compare acceptance across the four states",
  "Who should I call in Nevada?",
  "Which sites still need to be surveyed?",
] as const;

export default function SurveyAssistantPanel({ onCollapse }: { onCollapse: () => void }) {
  const chat = useSurveyChat();
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/health`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setConfigured(data ? Boolean(data.configured) : false);
      })
      .catch(() => {
        if (!cancelled) setConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <aside
      aria-label="SolarCycle data assistant"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-card/30"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          AI Assistant
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
            title="Hide the assistant"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:bg-muted/40"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {configured === false && (
        <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 font-mono text-[10px] leading-relaxed text-amber-700 dark:text-amber-100">
          The assistant isn&rsquo;t set up yet: the server needs an OPENAI_API_KEY.
        </div>
      )}

      <AgentMessageList
        messages={chat.messages}
        streamingText={chat.streamingText}
        progressText={chat.progressText}
        pendingConfirmation={null}
        isStreaming={chat.isStreaming}
        onConfirm={() => {}}
        onReject={() => {}}
        onSuggest={(text) => void chat.sendMessage(text)}
        introTitle="Survey assistant"
        introText="Ask me anything about the SolarCycle landfill survey — which sites take panels, what they charge, restrictions, or who to call. I answer only from the survey data."
        suggestions={SURVEY_PROMPTS}
      />

      <AgentInput
        disabled={false}
        isStreaming={chat.isStreaming}
        onSend={(text) => void chat.sendMessage(text)}
        onStop={chat.cancel}
        placeholder="Ask about the survey data…"
      />
    </aside>
  );
}
