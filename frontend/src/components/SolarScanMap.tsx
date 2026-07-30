// react-leaflet map for the solar-panel review-queue workflow: click to place a scan
// square, render color-coded detection polygons (pending/confirmed/rejected), fly to
// the selected detection. Declarative react-leaflet (vs. MapPanel.tsx's imperative
// raw-Leaflet API) scales better to the many independently-styled overlay layers here.
import { useEffect, useMemo, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON as LeafletGeoJSON,
  Circle,
  useMapEvents,
  useMap,
} from "react-leaflet";
import type { Layer, LeafletMouseEvent, PathOptions } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { SolarDetectionFeature } from "@/lib/solar-scan-api";

const ESRI_SATELLITE_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const STATUS_COLORS: Record<string, string> = {
  pending: "#ff6b4a", // coral
  confirmed: "#3dd68c", // seafoam
  rejected: "#7a8a99", // muted gray
};

interface SolarScanMapProps {
  detections: SolarDetectionFeature[];
  selectedId: number | null;
  scanCenter: [number, number] | null;
  radiusM: number;
  onMapClick: (lat: number, lng: number) => void;
  onSelectFeature: (id: number) => void;
  flyToTrigger: number;
}

function ClickCatcher({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e: LeafletMouseEvent) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function FlyToSelected({
  detections,
  selectedId,
  flyToTrigger,
}: {
  detections: SolarDetectionFeature[];
  selectedId: number | null;
  flyToTrigger: number;
}) {
  const map = useMap();
  const lastTrigger = useRef(0);
  useEffect(() => {
    if (flyToTrigger === lastTrigger.current) return;
    lastTrigger.current = flyToTrigger;
    if (selectedId == null) return;
    const f = detections.find((d) => d.properties.id === selectedId);
    if (!f) return;
    map.flyTo([f.properties.lat, f.properties.lng], Math.max(map.getZoom(), 18), { duration: 0.6 });
  }, [flyToTrigger, selectedId, detections, map]);
  return null;
}

export default function SolarScanMap({
  detections,
  selectedId,
  scanCenter,
  radiusM,
  onMapClick,
  onSelectFeature,
  flyToTrigger,
}: SolarScanMapProps) {
  const featureCollection = useMemo(
    () => ({ type: "FeatureCollection" as const, features: detections }),
    [detections],
  );

  const styleFor = useMemo(
    () =>
      (feature?: SolarDetectionFeature): PathOptions => {
        const id = feature?.properties.id;
        const status = feature?.properties.status ?? "pending";
        const selected = id === selectedId;
        return {
          color: selected ? "#ffffff" : STATUS_COLORS[status] ?? STATUS_COLORS.pending,
          weight: selected ? 3 : 1.5,
          fillColor: STATUS_COLORS[status] ?? STATUS_COLORS.pending,
          fillOpacity: selected ? 0.55 : 0.35,
        };
      },
    [selectedId],
  );

  const onEachFeature = (feature: SolarDetectionFeature, layer: Layer) => {
    layer.on("click", () => onSelectFeature(feature.properties.id));
  };

  return (
    <MapContainer center={[35.3833, -119.0187]} zoom={13} className="h-full w-full">
      <TileLayer
        url={ESRI_SATELLITE_TILE_URL}
        attribution="Esri, Maxar, Earthstar Geographics"
        maxZoom={20}
      />
      <ClickCatcher onMapClick={onMapClick} />
      <FlyToSelected detections={detections} selectedId={selectedId} flyToTrigger={flyToTrigger} />
      {scanCenter && (
        <Circle
          center={scanCenter}
          radius={radiusM}
          pathOptions={{ color: "#ffd166", weight: 2, dashArray: "6 6", fillOpacity: 0.05 }}
        />
      )}
      {detections.length > 0 && (
        <LeafletGeoJSON
          key={detections.map((d) => `${d.properties.id}:${d.properties.status}`).join(",")}
          data={featureCollection as GeoJSON.FeatureCollection}
          style={styleFor as (feature?: GeoJSON.Feature) => PathOptions}
          onEachFeature={onEachFeature as (feature: GeoJSON.Feature, layer: Layer) => void}
        />
      )}
    </MapContainer>
  );
}
