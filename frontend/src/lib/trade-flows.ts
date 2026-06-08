import type { Landfill } from "@/types/landfill";
import type { SolarStateStats } from "@/types/solar";
import { haversineDistanceMiles } from "@/lib/geo";
import { computeStateCoverage, isOpenLandfill, type StateCoverage } from "@/lib/state-coverage";

export interface ModelledTradeRoute {
  id: string;
  origin: string;
  originLat: number;
  originLng: number;
  destination: string;
  destState: string;
  destLat: number;
  destLng: number;
  estimatedVolumeTons: number;
  estimatedVolume: string;
  distanceMiles: number;
  mode: "Truck" | "Rail";
  legalStatus: "Tracked" | "Unmonitored" | "Flagged";
  isInternational: false;
  rationale: string;
}

/** Rough annual decommissioning pressure proxy (tons/yr) from installed solar MW. */
const TONS_PER_MW_YEAR = 0.65;
const MAX_ROUTES = 15;
const MAX_ROUTE_DISTANCE_MILES = 1200;

function stateCentroid(state: string, landfills: Landfill[]): { lat: number; lng: number } | null {
  const inState = landfills.filter((l) => l.state === state);
  const open = inState.filter(isOpenLandfill);
  const source = open.length > 0 ? open : inState;
  if (source.length === 0) return null;
  return {
    lat: source.reduce((s, l) => s + l.lat, 0) / source.length,
    lng: source.reduce((s, l) => s + l.lng, 0) / source.length,
  };
}

function isFlowOrigin(c: StateCoverage): boolean {
  return c.wasteDesert || (c.acceptanceProbability < 35 && c.solarMw >= 300);
}

function isFlowDestination(c: StateCoverage): boolean {
  return !c.wasteDesert && c.landfillCount >= 3 && c.acceptanceProbability >= 45;
}

function destinationLabel(dest: StateCoverage): string {
  const facility = dest.nearestFacility;
  if (facility.length > 40) {
    return `${dest.state} (${facility.slice(0, 37)}…)`;
  }
  return `${dest.state} (${facility})`;
}

function inferMode(distanceMiles: number): ModelledTradeRoute["mode"] {
  return distanceMiles <= 400 ? "Truck" : "Rail";
}

function inferLegalStatus(distanceMiles: number): ModelledTradeRoute["legalStatus"] {
  if (distanceMiles <= 250) return "Tracked";
  if (distanceMiles <= 600) return "Unmonitored";
  return "Flagged";
}

function destinationScore(dest: StateCoverage, distanceMiles: number): number {
  return dest.landfillCount * 10 + dest.acceptanceProbability - distanceMiles / 25;
}

/**
 * Model interstate PV waste flows from high-solar / low-coverage states toward
 * states with adequate open landfill capacity. Not observed trade data.
 */
export function computeModelledTradeRoutes(
  landfills: Landfill[],
  solarStats: SolarStateStats[],
): ModelledTradeRoute[] {
  const coverage = computeStateCoverage(landfills, solarStats);
  const origins = coverage.filter(isFlowOrigin).sort((a, b) => b.solarMw - a.solarMw);
  const destinations = coverage.filter(isFlowDestination);

  if (origins.length === 0 || destinations.length === 0) return [];

  const routes: ModelledTradeRoute[] = [];
  const usedPairs = new Set<string>();

  for (const origin of origins) {
    if (routes.length >= MAX_ROUTES) break;

    const originPoint = stateCentroid(origin.state, landfills);
    if (!originPoint) continue;

    let best: { dest: StateCoverage; distance: number; score: number } | null = null;

    for (const dest of destinations) {
      if (dest.state === origin.state) continue;

      const destPoint = stateCentroid(dest.state, landfills);
      if (!destPoint) continue;

      const distance = haversineDistanceMiles(
        originPoint.lat,
        originPoint.lng,
        destPoint.lat,
        destPoint.lng,
      );
      if (distance > MAX_ROUTE_DISTANCE_MILES) continue;

      const score = destinationScore(dest, distance);
      if (!best || score > best.score) {
        best = { dest, distance, score };
      }
    }

    if (!best) continue;

    const pairKey = `${origin.state}->${best.dest.state}`;
    if (usedPairs.has(pairKey)) continue;
    usedPairs.add(pairKey);

    const destPoint = stateCentroid(best.dest.state, landfills)!;
    const volumeTons = Math.max(50, Math.round(origin.solarMw * TONS_PER_MW_YEAR));
    const distanceMiles = Math.round(best.distance);

    routes.push({
      id: `flow-${origin.state}-${best.dest.state}`,
      origin: origin.state,
      originLat: originPoint.lat,
      originLng: originPoint.lng,
      destination: destinationLabel(best.dest),
      destState: best.dest.state,
      destLat: destPoint.lat,
      destLng: destPoint.lng,
      estimatedVolumeTons: volumeTons,
      estimatedVolume: `~${volumeTons.toLocaleString()} tons/yr`,
      distanceMiles,
      mode: inferMode(distanceMiles),
      legalStatus: inferLegalStatus(distanceMiles),
      isInternational: false,
      rationale: origin.wasteDesert
        ? `Waste desert: ${origin.landfillCount} open sites, ${origin.solarMw.toLocaleString()} MW solar`
        : `Low coverage (${origin.acceptanceProbability}% score) with ${origin.solarMw.toLocaleString()} MW solar`,
    });
  }

  return routes.sort((a, b) => b.estimatedVolumeTons - a.estimatedVolumeTons);
}
