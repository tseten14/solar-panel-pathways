import { useEffect, useRef } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { AgentMarkdown } from "./AgentMarkdown";
import AgentConfirmCard from "./AgentConfirmCard";
import { SUGGESTED_PROMPTS } from "./suggestedPrompts";
import type { AgentConfirmation, AgentMessage } from "./types";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export default function AgentMessageList({
  messages,
  streamingText,
  progressText,
  pendingConfirmation,
  isStreaming,
  onConfirm,
  onReject,
  onSuggest,
}: {
  messages: AgentMessage[];
  streamingText: string;
  progressText: string | null;
  pendingConfirmation: AgentConfirmation | null;
  isStreaming: boolean;
  onConfirm: (actionId: string) => void;
  onReject: (actionId: string) => void;
  onSuggest: (text: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Only auto-scroll when the user is already at the bottom, so scrolling back
  // to re-read something isn't yanked away by the next token.
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!stickToBottom.current) return;
    bottomRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, streamingText, progressText, pendingConfirmation]);

  const isEmpty =
    messages.length === 0 && !streamingText && !progressText && !pendingConfirmation;

  return (
    <div
      ref={scrollerRef}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
    >
      {isEmpty && (
        <div className="space-y-3 py-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Map assistant
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Ask me to scan an area, review detections, clean up false positives, or fly
            somewhere. I drive the map directly — you'll see it happen.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => onSuggest(prompt)}
                className="rounded-full border border-border/60 bg-background/30 px-2.5 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.map((m) => (
        <Turn key={m.id} role={m.role}>
          {m.role === "assistant" ? <AgentMarkdown text={m.content} /> : m.content}
        </Turn>
      ))}

      {progressText && (
        <Turn role="assistant">
          <span className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            {progressText}
          </span>
        </Turn>
      )}

      {streamingText && (
        <Turn role="assistant">
          <AgentMarkdown text={streamingText} />
        </Turn>
      )}

      {pendingConfirmation && (
        <AgentConfirmCard
          confirmation={pendingConfirmation}
          busy={isStreaming}
          onApprove={() => onConfirm(pendingConfirmation.actionId)}
          onReject={() => onReject(pendingConfirmation.actionId)}
        />
      )}

      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
}

function Turn({ role, children }: { role: "user" | "assistant"; children: React.ReactNode }) {
  const isUser = role === "user";
  return (
    <div className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
      <span className="px-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
        {isUser ? "You" : "Agent"}
      </span>
      <div
        className={`max-w-[92%] rounded-lg px-2.5 py-2 text-xs leading-relaxed ${
          isUser
            ? "bg-primary/15 text-foreground"
            : "border border-border/60 bg-card/60 text-foreground/90"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
