import { useState } from "react";
import { Send, Square } from "lucide-react";

export default function AgentInput({
  disabled,
  isStreaming,
  onSend,
  onStop,
}: {
  disabled: boolean;
  isStreaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled || isStreaming) return;
    onSend(trimmed);
    setText("");
  };

  return (
    <div className="shrink-0 border-t border-border/60 p-2.5">
      <div className="flex items-end gap-2">
        <textarea
          rows={2}
          value={text}
          disabled={disabled || isStreaming}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            disabled ? "Answer the question above first…" : "Ask me to scan, review, or navigate…"
          }
          className="min-h-[52px] flex-1 resize-none rounded-lg border border-border/60 bg-background/40 px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-primary/50 focus:outline-none disabled:opacity-50"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            title="Stop"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-destructive/40 bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={disabled || !text.trim()}
            title="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
