import type { Landfill } from "@/types/landfill";

const EARTH_RADIUS_MILES = 3958.7613;

/** Great-circle distance between two WGS84 points, in miles. */
export function haversineDistanceMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_MILES * c;
}

export interface NearestLandfillResult {
  landfill: Landfill;
  distanceMiles: number;
}

/** Nearest open landfill (operationalStatus === "Open") to the given point. */
export function findNearestLandfill(
  lat: number,
  lng: number,
  landfills: Landfill[],
): NearestLandfillResult | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const openSites = landfills.filter(
    (l) =>
      l.operationalStatus === "Open" &&
      Number.isFinite(l.lat) &&
      Number.isFinite(l.lng),
  );

  if (openSites.length === 0) return null;

  let nearest: NearestLandfillResult | null = null;
  for (const landfill of openSites) {
    const distanceMiles = haversineDistanceMiles(lat, lng, landfill.lat, landfill.lng);
    if (!nearest || distanceMiles < nearest.distanceMiles) {
      nearest = { landfill, distanceMiles };
    }
  }

  return nearest;
}
