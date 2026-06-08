import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

export interface ClusterMarker {
  id: string;
  lat: number;
  lng: number;
  color: string;
  radius?: number;
  fillOpacity?: number;
  weight?: number;
  onClick?: () => void;
}

interface ClusteredMarkersProps {
  markers: ClusterMarker[];
  radius?: number;
  fillOpacity?: number;
  weight?: number;
}

export function ClusteredMarkers({
  markers,
  radius = 7,
  fillOpacity = 0.75,
  weight = 2,
}: ClusteredMarkersProps) {
  const map = useMap();

  useEffect(() => {
    const clusterGroup = L.markerClusterGroup();

    for (const marker of markers) {
      const circle = L.circleMarker([marker.lat, marker.lng], {
        radius: marker.radius ?? radius,
        color: marker.color,
        fillColor: marker.color,
        fillOpacity: marker.fillOpacity ?? fillOpacity,
        weight: marker.weight ?? weight,
      });

      if (marker.onClick) {
        circle.on("click", marker.onClick);
      }

      clusterGroup.addLayer(circle);
    }

    map.addLayer(clusterGroup);

    return () => {
      map.removeLayer(clusterGroup);
      clusterGroup.clearLayers();
    };
  }, [map, markers, radius, fillOpacity, weight]);

  return null;
}
