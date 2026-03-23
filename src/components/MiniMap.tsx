import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import { landfills } from "@/data/mockData";
import "leaflet/dist/leaflet.css";

const statusColor = (status: string) => {
  if (status === "Yes") return "#22c55e";
  if (status === "No") return "#ef4444";
  return "#eab308";
};

export function MiniMap() {
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
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      {landfills.map((lf) => (
        <CircleMarker
          key={lf.id}
          center={[lf.lat, lf.lng]}
          radius={6}
          pathOptions={{
            color: statusColor(lf.acceptsPV),
            fillColor: statusColor(lf.acceptsPV),
            fillOpacity: 0.7,
            weight: 1,
          }}
        >
          <Popup>
            <span className="text-xs">{lf.name} — {lf.acceptsPV}</span>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
