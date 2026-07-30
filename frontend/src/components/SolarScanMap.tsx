// react-leaflet map for the solar-panel review-queue workflow: place one or many
// scan squares, render color-coded detection polygons (pending/confirmed/rejected),
// multi-select for merging, an erase circle, and fly-to on selection. Declarative
// react-leaflet scales better to the many independently-styled overlay layers here
// than an imperative raw-Leaflet API would.
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

export type ScanTool = "single" | "multi" | "erase";

interface SolarScanMapProps {
  detections: SolarDetectionFeature[];
  selectedIds: number[];
  focusedId: number | null;
  squares: Array<[number, number]>;
  radiusM: number;
  tool: ScanTool;
  onMapClick: (lat: number, lng: number) => void;
  onSelectFeature: (id: number, additive: boolean) => void;
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

function FlyToFocused({
  detections,
  focusedId,
  flyToTrigger,
}: {
  detections: SolarDetectionFeature[];
  focusedId: number | null;
  flyToTrigger: number;
}) {
  const map = useMap();
  const lastTrigger = useRef(0);
  useEffect(() => {
    if (flyToTrigger === lastTrigger.current) return;
    lastTrigger.current = flyToTrigger;
    if (focusedId == null) return;
    const f = detections.find((d) => d.properties.id === focusedId);
    if (!f) return;
    map.flyTo([f.properties.lat, f.properties.lng], Math.max(map.getZoom(), 18), { duration: 0.6 });
  }, [flyToTrigger, focusedId, detections, map]);
  return null;
}

export default function SolarScanMap({
  detections,
  selectedIds,
  focusedId,
  squares,
  radiusM,
  tool,
  onMapClick,
  onSelectFeature,
  flyToTrigger,
}: SolarScanMapProps) {
  const featureCollection = useMemo(
    () => ({ type: "FeatureCollection" as const, features: detections }),
    [detections],
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const styleFor = useMemo(
    () =>
      (feature?: SolarDetectionFeature): PathOptions => {
        const id = feature?.properties.id;
        const status = feature?.properties.status ?? "pending";
        const selected = id != null && selectedSet.has(id);
        return {
          color: selected ? "#ffffff" : STATUS_COLORS[status] ?? STATUS_COLORS.pending,
          weight: selected ? 3 : 1.5,
          fillColor: STATUS_COLORS[status] ?? STATUS_COLORS.pending,
          fillOpacity: selected ? 0.55 : 0.35,
        };
      },
    [selectedSet],
  );

  const onEachFeature = (feature: SolarDetectionFeature, layer: Layer) => {
    layer.on("click", (e: LeafletMouseEvent) => {
      // Stop the map's own click handler firing too (it would place a scan square).
      e.originalEvent?.stopPropagation();
      const additive = Boolean(e.originalEvent?.shiftKey);
      onSelectFeature(feature.properties.id, additive);
    });
  };

  const squareColor = tool === "erase" ? "#ff6b4a" : "#ffd166";

  return (
    <MapContainer center={[35.3833, -119.0187]} zoom={13} className="h-full w-full">
      <TileLayer
        url={ESRI_SATELLITE_TILE_URL}
        attribution="Esri, Maxar, Earthstar Geographics"
        maxZoom={20}
      />
      <ClickCatcher onMapClick={onMapClick} />
      <FlyToFocused detections={detections} focusedId={focusedId} flyToTrigger={flyToTrigger} />
      {squares.map(([lat, lng], i) => (
        <Circle
          key={`${lat},${lng},${i}`}
          center={[lat, lng]}
          radius={radiusM}
          pathOptions={{ color: squareColor, weight: 2, dashArray: "6 6", fillOpacity: 0.05 }}
        />
      ))}
      {detections.length > 0 && (
        <LeafletGeoJSON
          // Remount when data OR selection changes — react-leaflet's GeoJSON does not
          // re-run `style` on prop change, so the selection highlight needs a new key.
          key={`${detections.map((d) => `${d.properties.id}:${d.properties.status}`).join(",")}|${selectedIds.join(",")}`}
          data={featureCollection as GeoJSON.FeatureCollection}
          style={styleFor as (feature?: GeoJSON.Feature) => PathOptions}
          onEachFeature={onEachFeature as (feature: GeoJSON.Feature, layer: Layer) => void}
        />
      )}
    </MapContainer>
  );
}
