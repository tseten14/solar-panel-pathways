import { useState, useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import { landfills, type Landfill } from "@/data/mockData";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import "leaflet/dist/leaflet.css";

const statusColor = (s: string) => (s === "Yes" ? "#22c55e" : s === "No" ? "#ef4444" : "#eab308");

const states = [...new Set(landfills.map((l) => l.state))].sort();

export default function LandfillMap() {
  const [stateFilter, setStateFilter] = useState("all");
  const [ownershipFilter, setOwnershipFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [costRange, setCostRange] = useState([0, 150]);

  const filtered = useMemo(() => {
    return landfills.filter((l) => {
      if (stateFilter !== "all" && l.state !== stateFilter) return false;
      if (ownershipFilter !== "all" && l.ownership !== ownershipFilter) return false;
      if (statusFilter !== "all" && l.acceptsPV !== statusFilter) return false;
      if (l.tippingFee !== null && (l.tippingFee < costRange[0] || l.tippingFee > costRange[1])) return false;
      return true;
    });
  }, [stateFilter, ownershipFilter, statusFilter, costRange]);

  return (
    <div className="flex h-[calc(100vh-3rem)]">
      {/* Sidebar filters */}
      <div className="w-64 shrink-0 border-r border-border/50 bg-card/30 p-4 space-y-4 overflow-auto">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Filters</h2>

        <div>
          <label className="text-xs text-muted-foreground">State</label>
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All States</SelectItem>
              {states.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Ownership</label>
          <Select value={ownershipFilter} onValueChange={setOwnershipFilter}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="Municipal">Municipal</SelectItem>
              <SelectItem value="Private">Private</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Acceptance</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="Yes">Accepts</SelectItem>
              <SelectItem value="No">Rejects</SelectItem>
              <SelectItem value="Conditional">Conditional</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Cost Range ($/ton)</label>
          <Slider
            min={0}
            max={150}
            step={5}
            value={costRange}
            onValueChange={setCostRange}
            className="mt-3"
          />
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>${costRange[0]}</span>
            <span>${costRange[1]}</span>
          </div>
        </div>

        <div className="pt-2 border-t border-border/50">
          <p className="text-xs text-muted-foreground">{filtered.length} of {landfills.length} facilities shown</p>
        </div>

        {/* Legend */}
        <div className="pt-2 space-y-1">
          <p className="text-xs text-muted-foreground font-semibold">Legend</p>
          <div className="flex items-center gap-2 text-xs"><span className="w-3 h-3 rounded-full bg-status-accept inline-block" /> Accepts</div>
          <div className="flex items-center gap-2 text-xs"><span className="w-3 h-3 rounded-full bg-status-reject inline-block" /> Rejects</div>
          <div className="flex items-center gap-2 text-xs"><span className="w-3 h-3 rounded-full bg-status-conditional inline-block" /> Conditional</div>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1">
        <MapContainer
          center={[39.5, -98.35]}
          zoom={5}
          className="w-full h-full"
          attributionControl={false}
        >
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
          {filtered.map((lf) => (
            <CircleMarker
              key={lf.id}
              center={[lf.lat, lf.lng]}
              radius={8}
              pathOptions={{ color: statusColor(lf.acceptsPV), fillColor: statusColor(lf.acceptsPV), fillOpacity: 0.75, weight: 2 }}
            >
              <Popup>
                <LandfillPopup landfill={lf} />
              </Popup>
            </CircleMarker>
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
      <div className="flex gap-2">
        <Badge variant={l.acceptsPV === "Yes" ? "default" : l.acceptsPV === "No" ? "destructive" : "secondary"} className="text-xs">
          {l.acceptsPV === "Yes" ? "Accepts PV" : l.acceptsPV === "No" ? "Rejects PV" : "Conditional"}
        </Badge>
        <Badge variant="outline" className="text-xs">{l.ownership}</Badge>
      </div>
      <div className="text-xs space-y-1">
        <p><span className="text-muted-foreground">Location:</span> {l.county}, {l.state}</p>
        {l.tippingFee && <p><span className="text-muted-foreground">Tipping Fee:</span> ${l.tippingFee}/{l.tippingFeeUnit.replace("$/", "")}</p>}
        {l.minLoad && <p><span className="text-muted-foreground">Min Load:</span> {l.minLoad} tons</p>}
        <p><span className="text-muted-foreground">TCLP Required:</span> {l.tclpRequired ? "Yes" : "No"}</p>
        <p className="italic text-muted-foreground">{l.notes}</p>
      </div>
    </div>
  );
}
