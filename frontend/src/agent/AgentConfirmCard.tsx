import { AlertTriangle } from "lucide-react";
import type { AgentConfirmation } from "./types";

export default function AgentConfirmCard({
  confirmation,
  busy,
  onApprove,
  onReject,
}: {
  confirmation: AgentConfirmation;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="Confirm agent action"
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <p className="text-xs leading-relaxed text-foreground">{confirmation.summary}</p>
      </div>
      <div className="mt-2.5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          className="rounded-md border border-border/60 px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted/40 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className="rounded-md border border-amber-500/50 bg-amber-500/20 px-2.5 py-1 font-mono text-[11px] text-amber-200 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
