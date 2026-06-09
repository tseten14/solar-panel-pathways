import React, { useMemo } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker } from "react-leaflet";
import { Badge } from "@/components/ui/badge";
import { DataSourceBadge } from "@/components/DataSourceBadge";
import { DataFreshnessBadge } from "@/components/DataFreshnessBadge";
import { DataErrorState, DataLoadingState } from "@/components/DataLoadingState";
import { useLandfills } from "@/hooks/useLandfills";
import { useSolarStatsByState } from "@/hooks/useSolarData";
import { computeModelledTradeRoutes } from "@/lib/trade-flows";
import { Info } from "lucide-react";
import "leaflet/dist/leaflet.css";

const statusColor = (s: string) =>
  s === "Tracked" ? "#22c55e" : s === "Flagged" ? "#ef4444" : "#eab308";

function curvedRoute(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): [number, number][] {
  const midLat = (originLat + destLat) / 2;
  const midLng = (originLng + destLng) / 2;
  const bulge = Math.min(8, Math.abs(destLng - originLng) * 0.15);
  return [
    [originLat, originLng],
    [midLat + bulge * 0.3, midLng - bulge],
    [destLat, destLng],
  ];
}

export default function TradeFlows() {
  const { data: landfills = [], isLoading: landfillsLoading, isError: landfillsError, refetch } = useLandfills();
  const { data: solarStats = [], isLoading: solarLoading, isError: solarError } = useSolarStatsByState();

  const routes = useMemo(
    () => computeModelledTradeRoutes(landfills, solarStats),
    [landfills, solarStats],
  );

  const isLoading = landfillsLoading || solarLoading;
  const isError = landfillsError || solarError;

  if (isLoading) {
    return (
      <div className="p-6">
        <DataLoadingState message="Computing modelled PV waste flows from EPA + USGS data…" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <DataErrorState
          message="Failed to load data needed for flow modelling."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col lg:flex-row">
      <div className="flex-1 min-h-[300px]">
        <MapContainer center={[39.5, -98.35]} zoom={4} className="w-full h-full" attributionControl={false}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
          {routes.map((r) => (
            <React.Fragment key={r.id}>
              <Polyline
                positions={curvedRoute(r.originLat, r.originLng, r.destLat, r.destLng)}
                pathOptions={{
                  color: statusColor(r.legalStatus),
                  weight: Math.max(1.5, Math.min(4, r.estimatedVolumeTons / 400)),
                  opacity: 0.75,
                  dashArray: r.mode === "Rail" ? "4 8" : "8 6",
                }}
              />
              <CircleMarker
                center={[r.originLat, r.originLng]}
                radius={6}
                pathOptions={{ color: "#f59e0b", fillColor: "#f59e0b", fillOpacity: 0.9 }}
              />
              <CircleMarker
                center={[r.destLat, r.destLng]}
                radius={5}
                pathOptions={{
                  color: statusColor(r.legalStatus),
                  fillColor: statusColor(r.legalStatus),
                  fillOpacity: 0.9,
                }}
              />
            </React.Fragment>
          ))}
        </MapContainer>
      </div>

      <div className="w-full lg:w-96 border-l border-border/50 bg-card/30 overflow-auto p-4 space-y-3">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
            Modelled Interstate Flows
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <DataSourceBadge />
            <DataFreshnessBadge />
          </div>
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Routes are estimated from solar capacity and landfill coverage — not observed trade data.
            No public PV-waste shipment registry exists.
          </p>
        </div>

        {routes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No modelled flows match current thresholds.</p>
        ) : (
          routes.map((r) => (
            <div key={r.id} className="glass-card p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">
                  {r.origin} → {r.destination}
                </span>
                <Badge
                  variant={
                    r.legalStatus === "Tracked"
                      ? "default"
                      : r.legalStatus === "Flagged"
                        ? "destructive"
                        : "secondary"
                  }
                  className="text-xs shrink-0"
                >
                  {r.legalStatus}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p>Volume: {r.estimatedVolume} (est.)</p>
                <p>
                  Mode: {r.mode} · {r.distanceMiles} mi
                </p>
                <p className="italic">{r.rationale}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
