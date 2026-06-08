import type { Landfill } from "@/types/landfill";
import type { SolarStateStats } from "@/types/solar";

export interface StateCoverage {
  state: string;
  landfillCount: number;
  solarMw: number;
  acceptanceProbability: number;
  avgCost: number;
  nearestFacility: string;
  nearestDistance: number;
  wasteDesert: boolean;
  confidence: [number, number];
}

const EARTH_RADIUS_MILES = 3958.8;
const MUNICIPAL_COST = 85;
const PRIVATE_COST = 72;
const ACCEPTANCE_SCALE = 15;

export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isOpenLandfill(landfill: Landfill): boolean {
  return landfill.operationalStatus === "Open";
}

export function computeAcceptanceProbability(landfillCount: number, solarMw: number): number {
  const per1000Mw = solarMw > 0 ? (landfillCount / solarMw) * 1000 : landfillCount * 2;
  return Math.min(100, Math.max(0, Math.round(per1000Mw * ACCEPTANCE_SCALE)));
}

export function computeAvgCost(openLandfills: Landfill[]): number {
  const withFees = openLandfills.filter((l) => l.tippingFee != null);
  if (withFees.length > 0) {
    const sum = withFees.reduce((acc, l) => acc + l.tippingFee!, 0);
    return Math.round(sum / withFees.length);
  }
  if (openLandfills.length === 0) return Math.round((MUNICIPAL_COST + PRIVATE_COST) / 2);
  const municipalCount = openLandfills.filter((l) => l.ownership === "Municipal").length;
  const municipalRatio = municipalCount / openLandfills.length;
  return Math.round(municipalRatio * MUNICIPAL_COST + (1 - municipalRatio) * PRIVATE_COST);
}

export function computeConfidenceInterval(
  acceptanceProbability: number,
  landfillCount: number,
): [number, number] {
  const margin = Math.max(4, Math.round(25 / Math.sqrt(Math.max(landfillCount, 1))));
  return [
    Math.max(0, Math.round(acceptanceProbability - margin)),
    Math.min(100, Math.round(acceptanceProbability + margin)),
  ];
}

export function isWasteDesert(
  landfillCount: number,
  nearestDistance: number,
  solarMw: number,
): boolean {
  return landfillCount < 3 || (nearestDistance > 100 && solarMw > 500);
}

function stateReferencePoint(state: string, landfillsInState: Landfill[]): { lat: number; lng: number } | null {
  const openInState = landfillsInState.filter(isOpenLandfill);
  const source = openInState.length > 0 ? openInState : landfillsInState;
  if (source.length === 0) return null;
  const lat = source.reduce((sum, l) => sum + l.lat, 0) / source.length;
  const lng = source.reduce((sum, l) => sum + l.lng, 0) / source.length;
  return { lat, lng };
}

function findNearestOpenLandfill(
  point: { lat: number; lng: number },
  openLandfills: Landfill[],
): { facility: Landfill; distance: number } | null {
  if (openLandfills.length === 0) return null;
  let nearest: { facility: Landfill; distance: number } | null = null;
  for (const landfill of openLandfills) {
    const distance = haversineMiles(point.lat, point.lng, landfill.lat, landfill.lng);
    if (!nearest || distance < nearest.distance) {
      nearest = { facility: landfill, distance };
    }
  }
  return nearest;
}

export function computeStateCoverage(
  landfills: Landfill[],
  solarStats: SolarStateStats[],
): StateCoverage[] {
  const openLandfills = landfills.filter(isOpenLandfill);
  const landfillsByState = new Map<string, Landfill[]>();
  for (const landfill of landfills) {
    if (landfill.state === "—") continue;
    const list = landfillsByState.get(landfill.state) ?? [];
    list.push(landfill);
    landfillsByState.set(landfill.state, list);
  }

  return solarStats
    .map((stats) => {
      const landfillsInState = landfillsByState.get(stats.state) ?? [];
      const openInState = landfillsInState.filter(isOpenLandfill);
      const landfillCount = openInState.length;
      const acceptanceProbability = computeAcceptanceProbability(landfillCount, stats.totalCapacityMw);
      const avgCost = computeAvgCost(openInState);
      const reference = stateReferencePoint(stats.state, landfillsInState);

      let nearestFacility = "No open landfill nearby";
      let nearestDistance = Number.POSITIVE_INFINITY;

      if (reference) {
        const nearest = findNearestOpenLandfill(reference, openLandfills);
        if (nearest) {
          nearestFacility = nearest.facility.name;
          nearestDistance = Math.round(nearest.distance);
        }
      }

      if (!Number.isFinite(nearestDistance)) {
        nearestDistance = 999;
      }

      const wasteDesert = isWasteDesert(landfillCount, nearestDistance, stats.totalCapacityMw);
      const confidence = computeConfidenceInterval(acceptanceProbability, landfillCount);

      return {
        state: stats.state,
        landfillCount,
        solarMw: stats.totalCapacityMw,
        acceptanceProbability,
        avgCost,
        nearestFacility,
        nearestDistance,
        wasteDesert,
        confidence,
      };
    })
    .sort((a, b) => b.solarMw - a.solarMw);
}
