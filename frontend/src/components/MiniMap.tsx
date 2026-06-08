import { MapContainer, TileLayer, CircleMarker } from "react-leaflet";
import type { Landfill } from "@/types/landfill";
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
      {landfills.map((lf) => (
        <CircleMarker
          key={lf.id}
          center={[lf.lat, lf.lng]}
          radius={4}
          pathOptions={{
            color: statusColor(lf.acceptsPV),
            fillColor: statusColor(lf.acceptsPV),
            fillOpacity: 0.6,
            weight: 1,
          }}
        />
      ))}
    </MapContainer>
  );
}
