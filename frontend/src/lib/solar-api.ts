import { queryArcGISFeatures } from "@/lib/arcgis";
import type { SolarFacility, SolarStateStats } from "@/types/solar";

const USPVDB_URL =
  "https://energy.usgs.gov/arcgis/rest/services/Hosted/uspvdbDyn/FeatureServer/0/query";

interface SolarAttributes {
  objectid: number;
  p_name: string | null;
  p_state: string | null;
  p_county: string | null;
  p_cap_dc: number | null;
}

interface SolarStatsAttributes {
  p_state: string;
  total_mw: number;
  facility_count: number;
}

function polygonCentroid(rings: number[][][]): { lat: number; lng: number } | null {
  const ring = rings[0];
  if (!ring?.length) return null;
  let sumLat = 0;
  let sumLng = 0;
  for (const [lng, lat] of ring) {
    sumLat += lat;
    sumLng += lng;
  }
  return { lat: sumLat / ring.length, lng: sumLng / ring.length };
}

export function mapSolarFeature(feature: {
  attributes: SolarAttributes;
  geometry?: { rings?: number[][][]; x?: number; y?: number };
}): SolarFacility | null {
  const a = feature.attributes;
  if (!a.p_state) return null;

  let lat: number | undefined;
  let lng: number | undefined;

  if (feature.geometry?.rings) {
    const c = polygonCentroid(feature.geometry.rings);
    if (c) {
      lat = c.lat;
      lng = c.lng;
    }
  } else if (feature.geometry?.x != null && feature.geometry?.y != null) {
    lng = feature.geometry.x;
    lat = feature.geometry.y;
  }

  if (lat == null || lng == null) return null;

  return {
    id: String(a.objectid),
    name: a.p_name?.trim() || "Unnamed Solar Facility",
    state: a.p_state,
    county: a.p_county?.trim() || "—",
    capacityMw: a.p_cap_dc ?? 0,
    lat,
    lng,
  };
}

export async function fetchSolarStatsByState(): Promise<SolarStateStats[]> {
  const search = new URLSearchParams({
    where: "1=1",
    outStatistics: JSON.stringify([
      { statisticType: "sum", onStatisticField: "p_cap_dc", outStatisticFieldName: "total_mw" },
      { statisticType: "count", onStatisticField: "p_name", outStatisticFieldName: "facility_count" },
    ]),
    groupByFieldsForStatistics: "p_state",
    f: "json",
  });

  const res = await fetch(`${USPVDB_URL}?${search}`);
  if (!res.ok) throw new Error(`USPVDB stats request failed (${res.status})`);
  const data = (await res.json()) as {
    features?: { attributes: SolarStatsAttributes }[];
    error?: { message?: string };
  };
  if (data.error?.message) throw new Error(data.error.message);

  return (data.features ?? [])
    .map((f) => ({
      state: f.attributes.p_state,
      facilityCount: f.attributes.facility_count,
      totalCapacityMw: Math.round(f.attributes.total_mw * 10) / 10,
    }))
    .sort((a, b) => b.totalCapacityMw - a.totalCapacityMw);
}

export async function fetchSolarFacilitiesByState(state: string): Promise<SolarFacility[]> {
  const features = await queryArcGISFeatures<SolarAttributes>(USPVDB_URL, {
    where: `p_state='${state.replace(/'/g, "''")}'`,
    outFields: "objectid,p_name,p_state,p_county,p_cap_dc",
    returnGeometry: "true",
    outSR: "4326",
  });

  return features.map(mapSolarFeature).filter((f): f is SolarFacility => f !== null);
}
