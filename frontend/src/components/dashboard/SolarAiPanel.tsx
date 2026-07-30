// "Solar AI" dashboard Q&A dialog — structural port of ndc-data-explorer's
// DashboardAnalyzePanel.tsx: quick-action grid, scrollable conversation, chat
// input, plain-text rendering (no markdown, matching the reference), source-pill
// citations, non-streaming loading spinner.
import { useState, useRef, useCallback } from "react";
import { Sparkles, Send, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SOLAR_QUICK_ACTIONS, type SolarAiFact } from "@/lib/solar-ai-context";
import { solarAiAnalyze, type SolarAiCitation, type SolarAiResponse } from "@/lib/solar-ai-client";

const CHAT_EXAMPLE = "Which state leads in tracked solar capacity?";

type PanelEntry =
  | { kind: "loading"; label: string }
  | { kind: "result"; response: SolarAiResponse }
  | { kind: "error"; message: string };

interface SolarAiPanelProps {
  factLedger: SolarAiFact[];
}

export default function SolarAiPanel({ factLedger }: SolarAiPanelProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<PanelEntry[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const runAction = useCallback(
    async (opts: { action?: string; question?: string; label: string }) => {
      if (busy) return;
      setBusy(true);
      setEntries((prev) => [...prev, { kind: "loading", label: opts.label }]);
      try {
        const response = await solarAiAnalyze({
          action: opts.action,
          question: opts.question,
          fact_ledger: factLedger,
        });
        setEntries((prev) => [...prev.slice(0, -1), { kind: "result", response }]);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Solar AI request failed";
        setEntries((prev) => [...prev.slice(0, -1), { kind: "error", message }]);
      } finally {
        setBusy(false);
      }
    },
    [busy, factLedger],
  );

  const sendQuestion = useCallback(() => {
    const q = question.trim();
    if (!q || busy) return;
    setQuestion("");
    runAction({ question: q, label: q });
  }, [question, busy, runAction]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setEntries([]);
      setQuestion("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15">
          <Sparkles className="h-3.5 w-3.5" />
          Solar AI
        </button>
      </DialogTrigger>
      <DialogContent className="flex h-[85vh] max-w-2xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border/60 px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Solar AI
          </DialogTitle>
          <DialogDescription>
            Ask about tracked landfills, solar capacity, trade flows, or detection coverage.
            Answers cite only verified figures from this app's live data.
          </DialogDescription>
        </DialogHeader>

        {entries.length === 0 && (
          <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-border/60 p-4">
            {SOLAR_QUICK_ACTIONS.map((qa) => (
              <button
                key={qa.type}
                onClick={() => runAction({ action: qa.type, label: qa.label })}
                disabled={busy}
                className="rounded-lg border border-border/60 bg-background/30 p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
              >
                <div className="text-sm font-medium text-foreground">{qa.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{qa.description}</div>
              </button>
            ))}
          </div>
        )}

        <ScrollArea className="min-h-0 flex-1 px-5 py-4">
          <div className="space-y-5">
            {entries.map((entry, i) => (
              <PanelEntryView key={i} entry={entry} onFollowUp={(q) => runAction({ question: q, label: q })} />
            ))}
          </div>
        </ScrollArea>

        <div className="shrink-0 border-t border-border/60 p-3">
          <div className="flex items-end gap-2">
            <Textarea
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Tab" && !question) {
                  e.preventDefault();
                  setQuestion(CHAT_EXAMPLE);
                } else if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendQuestion();
                }
              }}
              placeholder="Ask a question… (Tab for an example)"
              rows={1}
              className="min-h-9 resize-none"
              disabled={busy}
            />
            <Button size="icon" onClick={sendQuestion} disabled={busy || !question.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PanelEntryView({
  entry,
  onFollowUp,
}: {
  entry: PanelEntry;
  onFollowUp: (q: string) => void;
}) {
  if (entry.kind === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Analysing: "{entry.label}"…
      </div>
    );
  }
  if (entry.kind === "error") {
    return <p className="text-sm text-destructive">{entry.message}</p>;
  }

  const { response } = entry;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{response.title}</h3>
        <ConfidenceBadge confidence={response.confidence} />
      </div>
      {response.sections.map((section, i) => (
        <div key={i} className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {section.heading}
          </h4>
          {section.lines.map((line, j) => (
            <p key={j} className="text-sm leading-relaxed text-foreground/90">
              {line.text}
            </p>
          ))}
        </div>
      ))}
      {response.disclaimer && (
        <p className="text-xs italic text-muted-foreground">{response.disclaimer}</p>
      )}
      {response.suggested_follow_ups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {response.suggested_follow_ups.map((q) => (
            <button
              key={q}
              onClick={() => onFollowUp(q)}
              className="rounded-full border border-border/60 bg-background/30 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              {q}
            </button>
          ))}
        </div>
      )}
      <SourcesFooter sources={response.sources} />
    </div>
  );
}

function SourcesFooter({ sources }: { sources: SolarAiCitation[] }) {
  if (sources.length === 0) return null;
  const byDomain = new Map<string, SolarAiCitation>();
  for (const s of sources) if (!byDomain.has(s.domain)) byDomain.set(s.domain, s);
  return (
    <div className="flex flex-wrap gap-1.5 border-t border-border/40 pt-2">
      {[...byDomain.values()].map((s) => (
        <a
          key={s.domain}
          href={s.url}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-border/50 bg-background/20 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-primary"
          title={s.claim}
        >
          {s.label}
        </a>
      ))}
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: SolarAiResponse["confidence"] }) {
  const styles =
    confidence === "high"
      ? "border-emerald-500/40 text-emerald-300"
      : confidence === "medium"
        ? "border-amber-500/40 text-amber-300"
        : "border-destructive/40 text-destructive";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${styles}`}>
      {confidence} confidence
    </span>
  );
}
