import React from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip } from "react-leaflet";
import { tradeRoutes } from "@/data/mockData";
import { Badge } from "@/components/ui/badge";
import "leaflet/dist/leaflet.css";

const statusColor = (s: string) => (s === "Tracked" ? "#22c55e" : s === "Flagged" ? "#ef4444" : "#eab308");

export default function TradeFlows() {
  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col lg:flex-row">
      {/* Map */}
      <div className="flex-1 min-h-[300px]">
        <MapContainer center={[30, -40]} zoom={3} className="w-full h-full" attributionControl={false}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
          {tradeRoutes.map((r) => {
            const midLat = (r.originLat + r.destLat) / 2;
            const midLng = (r.originLng + r.destLng) / 2 - 5;
            const positions: [number, number][] = [
              [r.originLat, r.originLng],
              [midLat + 5, midLng],
              [r.destLat, r.destLng],
            ];
            return (
              <div key={r.id}>
                <Polyline
                  positions={positions}
                  pathOptions={{
                    color: statusColor(r.legalStatus),
                    weight: 2,
                    opacity: 0.7,
                    dashArray: "8 6",
                  }}
                />
                <CircleMarker center={[r.originLat, r.originLng]} radius={5} pathOptions={{ color: "#f59e0b", fillColor: "#f59e0b", fillOpacity: 0.9 }}>
                  <Tooltip>{r.origin}</Tooltip>
                </CircleMarker>
                <CircleMarker center={[r.destLat, r.destLng]} radius={5} pathOptions={{ color: statusColor(r.legalStatus), fillColor: statusColor(r.legalStatus), fillOpacity: 0.9 }}>
                  <Tooltip>{r.destination}</Tooltip>
                </CircleMarker>
              </div>
            );
          })}
        </MapContainer>
      </div>

      {/* Table */}
      <div className="w-full lg:w-96 border-l border-border/50 bg-card/30 overflow-auto p-4 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">Trade Routes</h2>
        {tradeRoutes.map((r) => (
          <div key={r.id} className="glass-card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{r.origin} → {r.destination}</span>
              <Badge
                variant={r.legalStatus === "Tracked" ? "default" : r.legalStatus === "Flagged" ? "destructive" : "secondary"}
                className="text-xs"
              >
                {r.legalStatus}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p>Volume: {r.estimatedVolume}</p>
              <p>Mode: {r.mode}{r.isInternational ? " • International" : ""}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
