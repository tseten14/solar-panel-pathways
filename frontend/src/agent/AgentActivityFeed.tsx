import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import type { AgentActivityStep } from "./types";

export default function AgentActivityFeed({ activity }: { activity: AgentActivityStep[] }) {
  const [collapsed, setCollapsed] = useState(false);
  if (activity.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-border/60 bg-background/30">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
      >
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Activity ({activity.length})
      </button>
      {!collapsed && (
        <ul className="max-h-32 overflow-y-auto px-3 pb-2">
          {activity.map((step) => (
            <li key={step.id} className="flex items-center gap-1.5 py-0.5 font-mono text-[11px]">
              {step.phase === "running" ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
              ) : step.phase === "error" ? (
                <X className="h-3 w-3 shrink-0 text-destructive" />
              ) : (
                <Check className="h-3 w-3 shrink-0 text-emerald-400" />
              )}
              <span className={step.phase === "error" ? "text-destructive" : "text-muted-foreground"}>
                {step.label}
              </span>
              {step.detail && (
                <span className="truncate text-muted-foreground/70">— {step.detail}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
