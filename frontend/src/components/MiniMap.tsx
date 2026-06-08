import { useMemo } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import type { Landfill } from "@/types/landfill";
import { ClusteredMarkers } from "@/components/ClusteredMarkers";
import "leaflet/dist/leaflet.css";

const statusColor = (status: string) => {
  if (status === "Yes") return "#22c55e";
  if (status === "No") return "#ef4444";
  if (status === "Conditional") return "#eab308";
  return "#64748b";
};

interface MiniMapProps {
  landfills: Landfill[];
}

export function MiniMap({ landfills }: MiniMapProps) {
  const clusterMarkers = useMemo(
    () =>
      landfills.map((lf) => ({
        id: lf.id,
        lat: lf.lat,
        lng: lf.lng,
        color: statusColor(lf.acceptsPV),
        radius: 4,
        fillOpacity: 0.6,
        weight: 1,
      })),
    [landfills],
  );

  return (
    <MapContainer
      center={[39.5, -98.35]}
      zoom={4}
      className="w-full h-full rounded-lg"
      zoomControl={false}
      attributionControl={false}
      dragging={false}
      scrollWheelZoom={false}
      doubleClickZoom={false}
    >
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
      <ClusteredMarkers markers={clusterMarkers} radius={4} fillOpacity={0.6} weight={1} />
    </MapContainer>
  );
}
