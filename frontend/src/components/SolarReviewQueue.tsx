// Review-queue sidebar: pending-detection list, keyboard shortcuts, multi-select
// merge, stats footer, export buttons. Ported from the building-footprint
// reference's review-queue UX (accept/reject/skip/undo shortcuts, progress bar,
// shift-click merge, stats) for solar-array review.
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  X,
  SkipForward,
  Undo2,
  CheckCheck,
  Download,
  Loader2,
  Combine,
} from "lucide-react";
import type { SolarDetectionFeature, DetectionStats } from "@/lib/solar-scan-api";
import { exportUrl } from "@/lib/solar-scan-api";

interface SolarReviewQueueProps {
  pending: SolarDetectionFeature[];
  stats: DetectionStats | null;
  selectedIds: number[];
  focusedId: number | null;
  onSelect: (id: number, additive: boolean) => void;
  onConfirm: (id: number) => void;
  onReject: (id: number) => void;
  onRestore: (id: number) => void;
  onAcceptAll: () => void;
  onMerge: () => void;
  busy: boolean;
}

export default function SolarReviewQueue({
  pending,
  stats,
  selectedIds,
  focusedId,
  onSelect,
  onConfirm,
  onReject,
  onRestore,
  onAcceptAll,
  onMerge,
  busy,
}: SolarReviewQueueProps) {
  const [lastAction, setLastAction] = useState<number | null>(null);

  const activeIndex = useMemo(() => {
    if (focusedId == null) return 0;
    const idx = pending.findIndex((d) => d.properties.id === focusedId);
    return idx >= 0 ? idx : 0;
  }, [pending, focusedId]);

  const active = pending[activeIndex] ?? null;

  useEffect(() => {
    if (!active && pending.length > 0) onSelect(pending[0].properties.id, false);
  }, [active, pending, onSelect]);

  const advance = () => {
    const next = pending[activeIndex + 1] ?? pending[activeIndex - 1] ?? null;
    if (next) onSelect(next.properties.id, false);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (busy || !active) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "y" || e.key === "Y" || e.key === "ArrowRight") {
        e.preventDefault();
        setLastAction(active.properties.id);
        onConfirm(active.properties.id);
        advance();
      } else if (e.key === "n" || e.key === "N" || e.key === "ArrowLeft") {
        e.preventDefault();
        setLastAction(active.properties.id);
        onReject(active.properties.id);
        advance();
      } else if (e.key === " ") {
        e.preventDefault();
        advance();
      } else if (e.key === "u" || e.key === "U") {
        e.preventDefault();
        if (lastAction != null) {
          onRestore(lastAction);
          setLastAction(null);
        }
      } else if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        onAcceptAll();
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        if (selectedIds.length >= 2) onMerge();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const total = stats?.total ?? 0;
  const reviewed = (stats?.confirmed ?? 0) + (stats?.rejected ?? 0);
  const progressPct = total > 0 ? Math.round((reviewed / total) * 100) : 0;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/70 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            Review Queue
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">{pending.length} pending</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background/40">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
        </div>
        <p className="mt-1 font-mono text-[9px] text-muted-foreground">
          {reviewed} / {total} reviewed
        </p>
      </div>

      {selectedIds.length >= 2 && (
        <div className="shrink-0 border-b border-border/70 bg-primary/5 px-4 py-2">
          <button
            type="button"
            disabled={busy}
            onClick={onMerge}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2 py-1.5 font-mono text-[11px] text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
          >
            <Combine className="h-3.5 w-3.5" /> Merge {selectedIds.length} selected
          </button>
          <p className="mt-1 text-center font-mono text-[9px] text-muted-foreground">
            Shift-click to add · M to merge
          </p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {pending.length === 0 ? (
          <p className="p-4 font-mono text-xs text-muted-foreground">
            No pending detections. Place a scan square on the map and click Scan.
          </p>
        ) : (
          <ul>
            {pending.map((d) => {
              const id = d.properties.id;
              const isFocused = id === focusedId;
              const isSelected = selectedSet.has(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={(e) => onSelect(id, e.shiftKey)}
                    className={`flex w-full flex-col gap-0.5 border-b border-border/40 px-4 py-2.5 text-left transition-colors ${
                      isFocused
                        ? "bg-primary/15"
                        : isSelected
                          ? "bg-primary/8 ring-1 ring-inset ring-primary/30"
                          : "hover:bg-background/40"
                    }`}
                  >
                    <span className="font-mono text-xs text-foreground">
                      #{id} · {Math.round((d.properties.confidence ?? 0) * 100)}% conf.
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {Math.round(d.properties.area_m2).toLocaleString()} m² · compactness{" "}
                      {d.properties.compactness.toFixed(2)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {active && (
        <div className="shrink-0 border-t border-border/70 px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setLastAction(active.properties.id);
                onConfirm(active.properties.id);
                advance();
              }}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 font-mono text-[11px] text-emerald-300 transition-colors hover:bg-emerald-500/15 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" /> Confirm
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setLastAction(active.properties.id);
                onReject(active.properties.id);
                advance();
              }}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1.5 font-mono text-[11px] text-destructive transition-colors hover:bg-destructive/15 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" /> Delete
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={advance}
              title="Skip (Space)"
              className="flex items-center justify-center rounded-lg border border-border/60 bg-background/20 px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted/40 disabled:opacity-50"
            >
              <SkipForward className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={busy || lastAction == null}
              onClick={() => {
                if (lastAction != null) {
                  onRestore(lastAction);
                  setLastAction(null);
                }
              }}
              title="Undo (U)"
              className="flex items-center justify-center rounded-lg border border-border/60 bg-background/20 px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted/40 disabled:opacity-50"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-2 font-mono text-[9px] text-muted-foreground">
            Y/→ confirm · N/← delete · Space skip · U undo · A accept all · M merge
          </p>
        </div>
      )}

      <div className="shrink-0 border-t border-border/70 px-4 py-3">
        <div className="grid grid-cols-3 gap-2 font-mono text-[10px]">
          <StatTile label="Confirmed" value={stats?.confirmed ?? 0} className="text-emerald-300" />
          <StatTile label="Deleted" value={stats?.rejected ?? 0} className="text-destructive" />
          <StatTile
            label="Scanned"
            value={`${(stats?.scanned_area_km2 ?? 0).toFixed(2)} km²`}
            className="text-primary"
          />
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy || pending.length === 0}
            onClick={onAcceptAll}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2 py-1.5 font-mono text-[10px] text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
            Accept all
          </button>
          <a
            href={exportUrl("gpkg")}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-background/20 px-2 py-1.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-muted/40"
            title="Download confirmed as GeoPackage"
          >
            <Download className="h-3 w-3" /> GPKG
          </a>
          <a
            href={exportUrl("csv")}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-background/20 px-2 py-1.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-muted/40"
            title="Download confirmed as CSV"
          >
            <Download className="h-3 w-3" /> CSV
          </a>
        </div>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  className,
}: {
  label: string;
  value: string | number;
  className?: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/20 px-2 py-1.5 text-center">
      <div className={`font-semibold ${className ?? "text-foreground"}`}>{value}</div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}
