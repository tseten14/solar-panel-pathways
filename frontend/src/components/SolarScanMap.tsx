/**
 * The interactive map on the Solar Detections page.
 *
 * Shape matters here, because the shape you see is the area that is acted on:
 *   - SCAN areas are drawn as SQUARES, because a scan fetches a square
 *     bounding box of satellite imagery. Drawing a circle used to understate
 *     it — the corners of the real scan fell outside the circle shown.
 *   - The ERASE tool is drawn as a CIRCLE, because it deletes everything
 *     within a straight-line radius of the click.
 *
 * A faint preview follows the cursor so you can see where the square (or
 * circle) will land before committing.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON as LeafletGeoJSON,
  Circle,
  Rectangle,
  useMapEvents,
  useMap,
} from "react-leaflet";
import type { LatLngBoundsExpression, LatLngTuple } from "leaflet";
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

/** A camera move requested from outside the map. `nonce` makes repeat moves to
 *  the same coordinates take effect. */
export interface FlyTarget {
  lat: number;
  lng: number;
  zoom?: number;
  nonce: number;
}

export interface MapViewport {
  bbox: [number, number, number, number]; // [west, south, east, north]
  center: [number, number];
  zoom: number;
}

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
  flyTarget?: FlyTarget | null;
  onViewportChange?: (viewport: MapViewport) => void;
}

/**
 * Corners of the square that a scan of this radius will actually cover.
 * Mirrors the bbox the page sends to POST /scan, so the drawn square and the
 * fetched imagery are the same region.
 */
function squareOffsets(lat: number, radiusM: number) {
  return {
    dLat: radiusM / 111_320,
    dLng: radiusM / (111_320 * Math.cos((lat * Math.PI) / 180)),
  };
}

export function squareBounds(center: LatLngTuple, radiusM: number): LatLngBoundsExpression {
  const [lat, lng] = center;
  const { dLat, dLng } = squareOffsets(lat, radiusM);
  return [
    [lat - dLat, lng - dLng],
    [lat + dLat, lng + dLng],
  ];
}

/**
 * The same square as squareBounds(), expressed as the [west, south, east, north]
 * bbox that POST /scan expects. Sharing one definition keeps the square drawn on
 * screen identical to the imagery the backend fetches.
 */
export function scanBbox(
  center: LatLngTuple,
  radiusM: number,
): [number, number, number, number] {
  const [lat, lng] = center;
  const { dLat, dLng } = squareOffsets(lat, radiusM);
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

function ClickCatcher({
  onMapClick,
  onHover,
}: {
  onMapClick: (lat: number, lng: number) => void;
  onHover: (pos: LatLngTuple | null) => void;
}) {
  useMapEvents({
    click(e: LeafletMouseEvent) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
    mousemove(e: LeafletMouseEvent) {
      onHover([e.latlng.lat, e.latlng.lng]);
    },
    mouseout() {
      onHover(null);
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

/** Moves the camera when something outside the map (the AI agent) asks it to. */
function FlyToTarget({ target }: { target: FlyTarget | null | undefined }) {
  const map = useMap();
  const lastNonce = useRef(0);
  useEffect(() => {
    if (!target || target.nonce === lastNonce.current) return;
    lastNonce.current = target.nonce;
    map.flyTo([target.lat, target.lng], target.zoom ?? Math.max(map.getZoom(), 16), {
      duration: 0.8,
    });
  }, [target, map]);
  return null;
}

/** Reports what is on screen, so the agent can answer "scan what I'm looking at". */
function ViewportReporter({ onChange }: { onChange?: (viewport: MapViewport) => void }) {
  const map = useMap();
  useEffect(() => {
    if (!onChange) return;
    const report = () => {
      const bounds = map.getBounds();
      const center = map.getCenter();
      onChange({
        bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
        center: [center.lat, center.lng],
        zoom: map.getZoom(),
      });
    };
    report();
    map.on("moveend", report);
    return () => {
      map.off("moveend", report);
    };
  }, [map, onChange]);
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
  flyTarget,
  onViewportChange,
}: SolarScanMapProps) {
  const featureCollection = useMemo(
    () => ({ type: "FeatureCollection" as const, features: detections }),
    [detections],
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const [hoverPos, setHoverPos] = useState<LatLngTuple | null>(null);

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

  const isErase = tool === "erase";
  const SCAN_COLOR = "#ffd166";  // amber — areas queued for scanning
  const ERASE_COLOR = "#ff6b4a"; // coral — the delete radius

  return (
    <MapContainer center={[35.3833, -119.0187]} zoom={13} className="h-full w-full">
      <TileLayer
        url={ESRI_SATELLITE_TILE_URL}
        attribution="Esri, Maxar, Earthstar Geographics"
        maxZoom={20}
      />
      <ClickCatcher onMapClick={onMapClick} onHover={setHoverPos} />
      <FlyToFocused detections={detections} focusedId={focusedId} flyToTrigger={flyToTrigger} />
      <FlyToTarget target={flyTarget} />
      <ViewportReporter onChange={onViewportChange} />
      {/* Placed scan areas — squares, matching the bbox each scan fetches. */}
      {squares.map(([lat, lng], i) => (
        <Rectangle
          key={`${lat},${lng},${i}`}
          bounds={squareBounds([lat, lng], radiusM)}
          // Always the scan colour: these are queued scan areas, and tinting them
          // red in erase mode wrongly implied they were about to be deleted.
          pathOptions={{ color: SCAN_COLOR, weight: 2, dashArray: "6 6", fillOpacity: 0.05 }}
        />
      ))}
      {/* Preview under the cursor: square for scanning, circle for erasing. */}
      {hoverPos &&
        (isErase ? (
          <Circle
            center={hoverPos}
            radius={radiusM}
            interactive={false}
            pathOptions={{ color: ERASE_COLOR, weight: 1.5, dashArray: "4 6", fillOpacity: 0.04 }}
          />
        ) : (
          <Rectangle
            bounds={squareBounds(hoverPos, radiusM)}
            interactive={false}
            pathOptions={{ color: SCAN_COLOR, weight: 1.5, dashArray: "4 6", fillOpacity: 0.04 }}
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
