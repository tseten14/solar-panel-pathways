import { queryArcGISFeatures } from "@/lib/arcgis";
import type { SolarCohort, SolarFacility, SolarStateStats, SolarTechMix } from "@/types/solar";

const USPVDB_URL =
  "https://energy.usgs.gov/arcgis/rest/services/Hosted/uspvdbDyn/FeatureServer/0/query";

interface SolarAttributes {
  // Index signature satisfies queryArcGISFeatures<T extends Record<string, unknown>>.
  [key: string]: unknown;
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

const USE_BACKEND_CACHE = import.meta.env.VITE_USE_BACKEND_CACHE === "true";

function mapSolarStatsFeatures(features: { attributes: SolarStatsAttributes }[]): SolarStateStats[] {
  return features
    .map((f) => ({
      state: f.attributes.p_state,
      facilityCount: f.attributes.facility_count,
      totalCapacityMw: Math.round(f.attributes.total_mw * 10) / 10,
    }))
    .sort((a, b) => b.totalCapacityMw - a.totalCapacityMw);
}

async function fetchSolarStatsFromArcGIS(): Promise<SolarStateStats[]> {
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

  return mapSolarStatsFeatures(data.features ?? []);
}

async function fetchSolarStatsFromBackend(): Promise<SolarStateStats[]> {
  const res = await fetch("/api/solar/stats");
  if (!res.ok) throw new Error(`Backend solar stats request failed (${res.status})`);
  const data = (await res.json()) as { features?: { attributes: SolarStatsAttributes }[] };
  return mapSolarStatsFeatures(data.features ?? []);
}

export async function fetchSolarStatsByState(): Promise<SolarStateStats[]> {
  if (USE_BACKEND_CACHE) {
    try {
      return await fetchSolarStatsFromBackend();
    } catch {
      // Fall back to direct ArcGIS when backend cache is unavailable.
    }
    return fetchSolarStatsFromArcGIS();
  }
  // Live ArcGIS by default, but fall back to the backend's cached copy if the
  // upstream is unreachable or rate-limited (see fetchLandfills for rationale).
  try {
    return await fetchSolarStatsFromArcGIS();
  } catch (err) {
    try {
      return await fetchSolarStatsFromBackend();
    } catch {
      throw err; // surface the original upstream error, not the fallback's
    }
  }
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

const CAPACITY_STATS = JSON.stringify([
  { statisticType: "sum", onStatisticField: "p_cap_dc", outStatisticFieldName: "total_mw" },
  { statisticType: "count", onStatisticField: "p_name", outStatisticFieldName: "facility_count" },
]);

async function queryGrouped<T>(
  groupBy: string,
  where: string,
  map: (a: Record<string, unknown>) => T | null,
): Promise<T[]> {
  const search = new URLSearchParams({
    where,
    outStatistics: CAPACITY_STATS,
    groupByFieldsForStatistics: groupBy,
    f: "json",
  });
  const res = await fetch(`${USPVDB_URL}?${search}`);
  if (!res.ok) throw new Error(`USPVDB grouped query failed (${res.status})`);
  const data = (await res.json()) as {
    features?: { attributes: Record<string, unknown> }[];
    error?: { message?: string };
  };
  if (data.error?.message) throw new Error(data.error.message);
  return (data.features ?? []).map((f) => map(f.attributes)).filter((x): x is T => x !== null);
}

/**
 * Installed capacity grouped by state and commissioning year (USPVDB `p_year`).
 * This is the real basis for projecting when panels reach end of life.
 */
export function fetchSolarCohorts(): Promise<SolarCohort[]> {
  return queryGrouped<SolarCohort>("p_state,p_year", "p_year>0", (a) => {
    const state = a.p_state as string | null;
    const year = Number(a.p_year);
    if (!state || !Number.isFinite(year) || year <= 0) return null;
    return {
      state,
      year,
      facilityCount: Number(a.facility_count) || 0,
      capacityMw: Math.round((Number(a.total_mw) || 0) * 10) / 10,
    };
  });
}

/** Installed capacity grouped by module chemistry (USPVDB `p_tech_sec`). */
export function fetchSolarTechMix(): Promise<SolarTechMix[]> {
  return queryGrouped<SolarTechMix>("p_tech_sec", "1=1", (a) => {
    const tech = (a.p_tech_sec as string | null)?.trim();
    if (!tech) return null;
    return {
      tech,
      facilityCount: Number(a.facility_count) || 0,
      capacityMw: Math.round((Number(a.total_mw) || 0) * 10) / 10,
    };
  }).then((rows) => rows.sort((a, b) => b.capacityMw - a.capacityMw));
}
