import { useState, useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker } from "react-leaflet";
import type { Landfill } from "@/types/landfill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useLandfills } from "@/hooks/useLandfills";
import { useSolarFacilitiesByState } from "@/hooks/useSolarData";
import { DataErrorState, DataLoadingState } from "@/components/DataLoadingState";
import "leaflet/dist/leaflet.css";

const statusColor = (s: string) => {
  if (s === "Yes") return "#22c55e";
  if (s === "No") return "#ef4444";
  if (s === "Conditional") return "#eab308";
  return "#64748b";
};

export default function LandfillMap() {
  const { data: landfills = [], isLoading, isError, refetch } = useLandfills();
  const [stateFilter, setStateFilter] = useState("all");
  const [ownershipFilter, setOwnershipFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showSolar, setShowSolar] = useState(false);
  const [selectedLandfillId, setSelectedLandfillId] = useState<string | null>(null);

  const states = useMemo(
    () => [...new Set(landfills.map((l) => l.state).filter((s) => s !== "—"))].sort(),
    [landfills],
  );

  const solarState = showSolar && stateFilter !== "all" ? stateFilter : null;
  const { data: solarFacilities = [] } = useSolarFacilitiesByState(solarState);

  const filtered = useMemo(() => {
    return landfills.filter((l) => {
      if (stateFilter !== "all" && l.state !== stateFilter) return false;
      if (ownershipFilter !== "all" && l.ownership !== ownershipFilter) return false;
      if (statusFilter !== "all" && l.acceptsPV !== statusFilter) return false;
      return true;
    });
  }, [landfills, stateFilter, ownershipFilter, statusFilter]);

  const selectedLandfill =
    filtered.find((l) => l.id === selectedLandfillId) ?? filtered[0] ?? null;

  if (isLoading) {
    return <DataLoadingState message="Loading landfill map data from EPA LMOP…" />;
  }

  if (isError) {
    return (
      <DataErrorState message="Failed to load landfill data from EPA LMOP." onRetry={() => refetch()} />
    );
  }

  return (
    <div className="flex h-[calc(100vh-3rem)]">
      <div className="w-64 shrink-0 border-r border-border/50 bg-card/30 p-4 space-y-4 overflow-auto">
        <div>
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Filters</h2>
          <p className="text-xs text-muted-foreground mt-1">EPA LMOP · live data</p>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">State</label>
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All States</SelectItem>
              {states.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Ownership</label>
          <Select value={ownershipFilter} onValueChange={setOwnershipFilter}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="Municipal">Municipal</SelectItem>
              <SelectItem value="Private">Private</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">PV Acceptance</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="Unknown">Unknown</SelectItem>
              <SelectItem value="Yes">Accepts</SelectItem>
              <SelectItem value="No">Rejects</SelectItem>
              <SelectItem value="Conditional">Conditional</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="space-y-0.5">
            <Label htmlFor="solar-layer" className="text-xs text-muted-foreground">
              Solar facilities
            </Label>
            <p className="text-[10px] text-muted-foreground">USPVDB · select a state</p>
          </div>
          <Switch
            id="solar-layer"
            checked={showSolar}
            onCheckedChange={setShowSolar}
            disabled={stateFilter === "all"}
          />
        </div>
        {showSolar && stateFilter !== "all" && (
          <p className="text-xs text-muted-foreground">
            {solarFacilities.length.toLocaleString()} utility-scale solar sites in {stateFilter}
          </p>
        )}

        <div className="pt-2 border-t border-border/50">
          <p className="text-xs text-muted-foreground">
            {filtered.length.toLocaleString()} of {landfills.length.toLocaleString()} facilities shown
          </p>
        </div>

        <div className="pt-2 space-y-1">
          <p className="text-xs text-muted-foreground font-semibold">Legend</p>
          <div className="flex items-center gap-2 text-xs">
            <span className="w-3 h-3 rounded-full inline-block" style={{ background: statusColor("Yes") }} /> Landfill
            (accepts)
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="w-3 h-3 rounded-full inline-block" style={{ background: statusColor("Unknown") }} />{" "}
            Landfill (unknown PV policy)
          </div>
          {showSolar && (
            <div className="flex items-center gap-2 text-xs">
              <span className="w-3 h-3 rounded-full bg-amber-400 inline-block" /> Solar facility (USPVDB)
            </div>
          )}
        </div>

        {selectedLandfill && (
          <div className="pt-3 border-t border-border/50 space-y-2">
            <p className="text-xs text-muted-foreground font-semibold">Selected Facility</p>
            <LandfillPopup landfill={selectedLandfill} />
          </div>
        )}
      </div>

      <div className="flex-1">
        <MapContainer center={[39.5, -98.35]} zoom={5} className="w-full h-full" attributionControl={false}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
          {filtered.map((lf) => (
            <CircleMarker
              key={lf.id}
              center={[lf.lat, lf.lng]}
              radius={7}
              pathOptions={{
                color: statusColor(lf.acceptsPV),
                fillColor: statusColor(lf.acceptsPV),
                fillOpacity: 0.75,
                weight: 2,
              }}
              eventHandlers={{ click: () => setSelectedLandfillId(lf.id) }}
            />
          ))}
          {showSolar &&
            solarFacilities.map((sf) => (
              <CircleMarker
                key={`solar-${sf.id}`}
                center={[sf.lat, sf.lng]}
                radius={5}
                pathOptions={{
                  color: "#f59e0b",
                  fillColor: "#f59e0b",
                  fillOpacity: 0.85,
                  weight: 1,
                }}
              />
            ))}
        </MapContainer>
      </div>
    </div>
  );
}

function LandfillPopup({ landfill: l }: { landfill: Landfill }) {
  return (
    <div className="space-y-2 min-w-[220px]">
      <h3 className="font-semibold text-sm">{l.name}</h3>
      <div className="flex gap-2 flex-wrap">
        <Badge
          variant={l.acceptsPV === "Yes" ? "default" : l.acceptsPV === "No" ? "destructive" : "secondary"}
          className="text-xs"
        >
          PV: {l.acceptsPV}
        </Badge>
        <Badge variant="outline" className="text-xs">
          {l.ownership}
        </Badge>
        {l.operationalStatus && (
          <Badge variant="outline" className="text-xs">
            {l.operationalStatus}
          </Badge>
        )}
      </div>
      <div className="text-xs space-y-1">
        <p>
          <span className="text-muted-foreground">Location:</span> {l.county}, {l.state}
        </p>
        <p className="italic text-muted-foreground">{l.notes}</p>
      </div>
    </div>
  );
}
