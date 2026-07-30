import { useMemo } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import type { Landfill } from "@/types/landfill";
import { ClusteredMarkers } from "@/components/ClusteredMarkers";
import { useThemeTokens } from "@/hooks/useThemeTokens";
import "leaflet/dist/leaflet.css";

interface MiniMapProps {
  landfills: Landfill[];
}

export function MiniMap({ landfills }: MiniMapProps) {
  const { basemapUrl, status } = useThemeTokens();
  /** Colour by EPA LMOP operational status (a real reported field). */
  const statusColor = (s?: string) =>
    s === "Open" ? status.open : s === "Closed" ? status.closed : status.unknown;

  const clusterMarkers = useMemo(
    () =>
      landfills.map((lf) => ({
        id: lf.id,
        lat: lf.lat,
        lng: lf.lng,
        color: statusColor(lf.operationalStatus),
        radius: 4,
        fillOpacity: 0.6,
        weight: 1,
      })),
    [landfills, status],
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
      <TileLayer url={basemapUrl} />
      <ClusteredMarkers markers={clusterMarkers} radius={4} fillOpacity={0.6} weight={1} />
    </MapContainer>
  );
}
