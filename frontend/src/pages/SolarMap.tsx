import { useState, useCallback, useEffect, useMemo } from "react";
import { MapPin, Eye, ScanSearch } from "lucide-react";
import { GeoAiMark } from "@/components/GeoAiMark";
import SolarScanMap from "@/components/SolarScanMap";
import SolarReviewQueue from "@/components/SolarReviewQueue";
import { fetchBackendHealth, type BackendHealth } from "@/lib/apiHealth";
import type { DetectionEngineId } from "@/types/detection";
import {
  scanArea,
  fetchDetections,
  fetchDetectionStats,
  decideDetection,
  decideBatch,
  type SolarDetectionFeature,
  type DetectionStats,
} from "@/lib/solar-scan-api";

const Index = () => {
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null);
  const sam3Available = backendHealth?.sam3_loaded ?? false;
  const yoloAvailable = backendHealth?.yolo_available ?? false;

  const [detections, setDetections] = useState<SolarDetectionFeature[]>([]);
  const [stats, setStats] = useState<DetectionStats | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [flyTrigger, setFlyTrigger] = useState(0);
  const [scanCenter, setScanCenter] = useState<[number, number] | null>(null);
  const [radiusM, setRadiusM] = useState(200);
  const [engine, setEngine] = useState<DetectionEngineId>("sam3");
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
    fetchBackendHealth().then((health) => {
      setBackendHealth(health);
      if (!health) return;
      if (engine === "sam3" && !health.sam3_loaded && health.yolo_available) setEngine("yolo");
      else if (engine === "yolo" && !health.yolo_available && health.sam3_loaded) setEngine("sam3");
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = useMemo(() => detections.filter((d) => d.properties.status === "pending"), [detections]);

  const handleMapClick = useCallback((lat: number, lng: number) => {
    setScanCenter([lat, lng]);
  }, []);

  const handleSelect = useCallback((id: number) => {
    setSelectedId(id);
    setFlyTrigger((t) => t + 1);
  }, []);

  const handleScanArea = useCallback(async () => {
    if (!scanCenter || busy) return;
    setBusy(true);
    setStatus("Scanning...");
    try {
      const [lat, lng] = scanCenter;
      const dLat = radiusM / 111_320;
      const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
      const bbox: [number, number, number, number] = [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
      const result = await scanArea(bbox, engine, { center: scanCenter, radius_m: radiusM });
      setStatus(`Scan complete: ${result.stored.pending} new, ${result.stored.skipped} skipped.`);
      await refreshData();
    } catch (err) {
      console.error("Scan failed:", err);
      setStatus(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setBusy(false);
      setTimeout(() => setStatus(""), 4000);
    }
  }, [scanCenter, radiusM, engine, busy, refreshData]);

  const handleConfirm = useCallback(
    async (id: number) => {
      try {
        await decideDetection(id, "confirm");
        await refreshData();
      } catch (err) {
        console.error("Confirm failed:", err);
      }
    },
    [refreshData],
  );

  const handleReject = useCallback(
    async (id: number) => {
      try {
        await decideDetection(id, "reject");
        await refreshData();
      } catch (err) {
        console.error("Reject failed:", err);
      }
    },
    [refreshData],
  );

  const handleRestore = useCallback(
    async (id: number) => {
      try {
        await decideDetection(id, "restore");
        await refreshData();
      } catch (err) {
        console.error("Restore failed:", err);
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

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 opacity-[0.55] grid-bg" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(1100px_circle_at_18%_12%,hsl(var(--primary)/0.16),transparent_45%),radial-gradient(900px_circle_at_85%_22%,hsl(150_70%_45%/0.10),transparent_45%),radial-gradient(1200px_circle_at_50%_85%,hsl(40_90%_55%/0.08),transparent_55%)]" />

      <header className="relative z-30 flex items-center justify-between border-b border-border/70 bg-card/70 px-6 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3.5">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-gradient-to-br from-primary/20 via-background/20 to-background/10 shadow-[0_0_0_1px_hsl(var(--primary)/0.12),0_16px_34px_-22px_hsl(var(--primary)/0.55)]">
            <div className="pointer-events-none absolute inset-0 rounded-xl bg-[radial-gradient(14px_circle_at_30%_30%,hsl(var(--primary)/0.35),transparent_60%)]" />
            <GeoAiMark className="relative h-7 w-7 shrink-0 drop-shadow-[0_0_14px_hsl(var(--primary)/0.4)]" />
          </div>
          <div>
            <h1 className="font-brand text-[19px] leading-none sm:text-[23px]">
              <span className="text-foreground">Solar</span>
              <span className="text-[#81e6d9] drop-shadow-[0_0_14px_hsl(173_80%_50%/0.35)]">Trace</span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <StatusIndicator icon={<MapPin className="h-3 w-3" />} label="Scan area" active={!!scanCenter} />
          <StatusIndicator icon={<Eye className="h-3 w-3" />} label="Detections" active={detections.length > 0} />
          <div className="ml-2 hidden rounded-md border border-border/60 bg-background/30 px-2.5 py-1 font-mono text-[10px] tracking-wide text-muted-foreground sm:block">
            Solar panel detection
          </div>
        </div>
      </header>

      <BackendStatusBanner health={backendHealth} sam3Available={sam3Available} yoloAvailable={yoloAvailable} />

      <div className="relative z-20 flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 shrink-0 overflow-hidden border-r border-border/70 bg-card/20">
          <div className="flex h-full w-full flex-col gap-2 p-3">
            <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card/70 px-3 py-2 backdrop-blur-md">
              <span className="font-mono text-[10px] text-muted-foreground">
                {scanCenter
                  ? `Center: ${scanCenter[0].toFixed(4)}, ${scanCenter[1].toFixed(4)}`
                  : "Click the map to place a scan square"}
              </span>
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
                <div className="flex overflow-hidden rounded-lg border border-border/70">
                  <button
                    type="button"
                    onClick={() => setEngine("sam3")}
                    className={`px-2 py-1 font-mono text-[10px] ${engine === "sam3" ? "bg-violet-500/20 text-violet-200" : "text-muted-foreground"}`}
                  >
                    SAM 3
                  </button>
                  <button
                    type="button"
                    onClick={() => setEngine("yolo")}
                    className={`border-l border-border/70 px-2 py-1 font-mono text-[10px] ${engine === "yolo" ? "bg-amber-500/15 text-amber-200" : "text-muted-foreground"}`}
                  >
                    YOLO
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleScanArea}
                  disabled={!scanCenter || busy}
                  className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[11px] text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
                >
                  <ScanSearch className="h-3.5 w-3.5" /> Scan
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
                selectedId={selectedId}
                scanCenter={scanCenter}
                radiusM={radiusM}
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
            selectedId={selectedId}
            onSelect={handleSelect}
            onConfirm={handleConfirm}
            onReject={handleReject}
            onRestore={handleRestore}
            onAcceptAll={handleAcceptAll}
            busy={busy}
          />
        </div>
      </div>
    </div>
  );
};

function BackendStatusBanner({
  health,
  sam3Available,
  yoloAvailable,
}: {
  health: BackendHealth | null;
  sam3Available: boolean;
  yoloAvailable: boolean;
}) {
  if (health === null) {
    return (
      <div className="relative z-20 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 font-mono text-[11px] text-amber-100">
        Backend offline — start the API on port 8000 to scan.
      </div>
    );
  }
  const issues: string[] = [];
  if (!sam3Available) issues.push("SAM 3 (set HF_TOKEN)");
  if (!yoloAvailable) issues.push("YOLO (add .pt weights)");
  if (issues.length === 0) return null;
  return (
    <div className="relative z-20 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 font-mono text-[11px] text-amber-100">
      Partial backend setup: {issues.join(" · ")}
    </div>
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
