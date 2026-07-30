import { useState, useCallback, useEffect, useMemo } from "react";
import { MapPin, Eye, ScanSearch, Square, Grid2x2, Eraser, Trash2 } from "lucide-react";
import { GeoAiMark } from "@/components/GeoAiMark";
import SolarScanMap, { type ScanTool } from "@/components/SolarScanMap";
import SolarReviewQueue from "@/components/SolarReviewQueue";
import { fetchBackendHealth, type BackendHealth } from "@/lib/apiHealth";
import {
  scanArea,
  fetchDetections,
  fetchDetectionStats,
  decideDetection,
  decideBatch,
  mergeDetections,
  eraseCircle,
  type SolarDetectionFeature,
  type DetectionStats,
} from "@/lib/solar-scan-api";

const Index = () => {
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null);
  const sam3Available = backendHealth?.sam3_loaded ?? false;

  const [detections, setDetections] = useState<SolarDetectionFeature[]>([]);
  const [stats, setStats] = useState<DetectionStats | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [flyTrigger, setFlyTrigger] = useState(0);

  const [tool, setTool] = useState<ScanTool>("single");
  const [squares, setSquares] = useState<Array<[number, number]>>([]);
  const [radiusM, setRadiusM] = useState(200);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const refreshData = useCallback(async () => {
    try {
      const [detRes, statsRes] = await Promise.all([fetchDetections(), fetchDetectionStats()]);
      setDetections(detRes.features);
      setStats(statsRes);
    } catch (err) {
      console.error("Failed to refresh review data:", err);
    }
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  useEffect(() => {
    fetchBackendHealth().then(setBackendHealth);
  }, []);

  const pending = useMemo(() => detections.filter((d) => d.properties.status === "pending"), [detections]);

  const flash = useCallback((msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(""), 4000);
  }, []);

  const handleSelect = useCallback((id: number, additive: boolean) => {
    if (additive) {
      setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
      setFocusedId(id);
      return;
    }
    setSelectedIds([id]);
    setFocusedId(id);
    setFlyTrigger((t) => t + 1);
  }, []);

  const bboxAround = (lat: number, lng: number): [number, number, number, number] => {
    const dLat = radiusM / 111_320;
    const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
    return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
  };

  const handleMapClick = useCallback(
    async (lat: number, lng: number) => {
      if (busy) return;
      if (tool === "erase") {
        setBusy(true);
        try {
          const res = await eraseCircle([lat, lng], radiusM);
          flash(`Deleted ${res.erased} detection${res.erased === 1 ? "" : "s"} in the circle.`);
          await refreshData();
        } catch (err) {
          console.error("Erase failed:", err);
          flash(err instanceof Error ? err.message : "Erase failed");
        } finally {
          setBusy(false);
        }
        return;
      }
      if (tool === "multi") {
        setSquares((prev) => [...prev, [lat, lng]]);
      } else {
        setSquares([[lat, lng]]);
      }
    },
    [tool, radiusM, busy, refreshData, flash],
  );

  const handleScan = useCallback(async () => {
    if (squares.length === 0 || busy) return;
    setBusy(true);
    let totalNew = 0;
    let totalSkipped = 0;
    try {
      // Scan squares one at a time, persisting after each, so partial progress
      // survives a failure partway through a multi-square run.
      for (let i = 0; i < squares.length; i++) {
        const [lat, lng] = squares[i];
        setStatus(`Scanning square ${i + 1} of ${squares.length}…`);
        const result = await scanArea(bboxAround(lat, lng), "sam3", {
          center: [lat, lng],
          radius_m: radiusM,
        });
        totalNew += result.stored.pending;
        totalSkipped += result.stored.skipped;
        await refreshData();
      }
      flash(`Scanned ${squares.length} square${squares.length === 1 ? "" : "s"}: ${totalNew} new, ${totalSkipped} skipped.`);
      setSquares([]);
    } catch (err) {
      console.error("Scan failed:", err);
      flash(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setBusy(false);
    }
  }, [squares, radiusM, busy, refreshData, flash]); // eslint-disable-line react-hooks/exhaustive-deps

  const decide = useCallback(
    async (id: number, action: "confirm" | "reject" | "restore") => {
      try {
        await decideDetection(id, action);
        await refreshData();
      } catch (err) {
        console.error(`${action} failed:`, err);
      }
    },
    [refreshData],
  );

  const handleAcceptAll = useCallback(async () => {
    if (pending.length === 0) return;
    setBusy(true);
    try {
      await decideBatch(pending.map((d) => d.properties.id), "confirmed");
      await refreshData();
    } catch (err) {
      console.error("Accept all failed:", err);
    } finally {
      setBusy(false);
    }
  }, [pending, refreshData]);

  const handleMerge = useCallback(async () => {
    if (selectedIds.length < 2 || busy) return;
    setBusy(true);
    try {
      const res = await mergeDetections(selectedIds);
      flash(`Merged ${selectedIds.length} detections into #${res.merged_id}.`);
      setSelectedIds([res.merged_id]);
      setFocusedId(res.merged_id);
      await refreshData();
    } catch (err) {
      console.error("Merge failed:", err);
      flash(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setBusy(false);
    }
  }, [selectedIds, busy, refreshData, flash]);

  const toolHint =
    tool === "erase"
      ? "Click the map to delete every detection inside the circle"
      : tool === "multi"
        ? `Click to add scan squares (${squares.length} placed)`
        : "Click the map to place a scan square";

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 opacity-[0.55] grid-bg" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(1100px_circle_at_18%_12%,hsl(var(--primary)/0.16),transparent_45%),radial-gradient(900px_circle_at_85%_22%,hsl(150_70%_45%/0.10),transparent_45%)]" />

      <header className="relative z-30 flex items-center justify-between border-b border-border/70 bg-card/70 px-6 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3.5">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-gradient-to-br from-primary/20 via-background/20 to-background/10">
            <GeoAiMark className="relative h-7 w-7 shrink-0 drop-shadow-[0_0_14px_hsl(var(--primary)/0.4)]" />
          </div>
          <h1 className="font-brand text-[19px] leading-none sm:text-[23px]">
            <span className="text-foreground">Solar</span>
            <span className="text-[#81e6d9] drop-shadow-[0_0_14px_hsl(173_80%_50%/0.35)]">Trace</span>
          </h1>
        </div>

        <div className="flex items-center gap-4">
          <StatusIndicator icon={<MapPin className="h-3 w-3" />} label="Scan area" active={squares.length > 0} />
          <StatusIndicator icon={<Eye className="h-3 w-3" />} label="Detections" active={detections.length > 0} />
          <div className="ml-2 hidden rounded-md border border-border/60 bg-background/30 px-2.5 py-1 font-mono text-[10px] tracking-wide text-muted-foreground sm:block">
            SAM 3 · solar panel detection
          </div>
        </div>
      </header>

      {backendHealth === null ? (
        <div className="relative z-20 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 font-mono text-[11px] text-amber-100">
          Backend offline — start the API on port 8000 to scan.
        </div>
      ) : !sam3Available ? (
        <div className="relative z-20 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 font-mono text-[11px] text-amber-100">
          SAM 3 not loaded — set HF_TOKEN and restart the backend.
        </div>
      ) : null}

      <div className="relative z-20 flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 shrink-0 overflow-hidden border-r border-border/70 bg-card/20">
          <div className="flex h-full w-full flex-col gap-2 p-3">
            <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card/70 px-3 py-2 backdrop-blur-md">
              <div className="flex overflow-hidden rounded-lg border border-border/70">
                <ToolButton active={tool === "single"} onClick={() => setTool("single")} title="Single scan square">
                  <Square className="h-3 w-3" /> Single
                </ToolButton>
                <ToolButton active={tool === "multi"} onClick={() => setTool("multi")} title="Place multiple scan squares">
                  <Grid2x2 className="h-3 w-3" /> Multi
                </ToolButton>
                <ToolButton active={tool === "erase"} onClick={() => setTool("erase")} title="Delete detections inside a circle">
                  <Eraser className="h-3 w-3" /> Erase
                </ToolButton>
              </div>

              <span className="font-mono text-[10px] text-muted-foreground">{toolHint}</span>

              <div className="ml-auto flex items-center gap-2">
                <label className="font-mono text-[10px] text-muted-foreground">Radius {radiusM}m</label>
                <input
                  type="range"
                  min={50}
                  max={800}
                  step={25}
                  value={radiusM}
                  onChange={(e) => setRadiusM(Number(e.target.value))}
                  className="w-24"
                />
                {squares.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSquares([])}
                    disabled={busy}
                    title="Clear placed squares"
                    className="flex items-center justify-center rounded-lg border border-border/60 bg-background/20 px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted/40 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleScan}
                  disabled={squares.length === 0 || busy || tool === "erase"}
                  className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[11px] text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
                >
                  <ScanSearch className="h-3.5 w-3.5" />
                  {squares.length > 1 ? `Scan all (${squares.length})` : "Scan"}
                </button>
              </div>
            </div>

            {status && (
              <div className="shrink-0 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 font-mono text-[11px] text-primary">
                {status}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/70">
              <SolarScanMap
                detections={detections}
                selectedIds={selectedIds}
                focusedId={focusedId}
                squares={squares}
                radiusM={radiusM}
                tool={tool}
                onMapClick={handleMapClick}
                onSelectFeature={handleSelect}
                flyToTrigger={flyTrigger}
              />
            </div>
          </div>
        </div>

        <div className="w-[340px] shrink-0 overflow-hidden bg-card/30">
          <SolarReviewQueue
            pending={pending}
            stats={stats}
            selectedIds={selectedIds}
            focusedId={focusedId}
            onSelect={handleSelect}
            onConfirm={(id) => decide(id, "confirm")}
            onReject={(id) => decide(id, "reject")}
            onRestore={(id) => decide(id, "restore")}
            onAcceptAll={handleAcceptAll}
            onMerge={handleMerge}
            busy={busy}
          />
        </div>
      </div>
    </div>
  );
};

function ToolButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1 border-border/70 px-2.5 py-1.5 font-mono text-[10px] transition-colors [&:not(:first-child)]:border-l ${
        active ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}

function StatusIndicator({
  icon,
  label,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 font-mono text-[11px]">
      <div className={`transition-opacity duration-300 ${active ? "text-primary opacity-100" : "text-muted-foreground opacity-30"}`}>
        {icon}
      </div>
      <span className={active ? "text-primary" : "text-muted-foreground"}>{label}</span>
      <div className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${active ? "bg-green-500" : "bg-muted-foreground/30"}`} />
    </div>
  );
}

export default Index;
