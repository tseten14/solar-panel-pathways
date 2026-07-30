/**
 * Per-state disposal-capacity picture, derived only from real feeds:
 * EPA LMOP landfills (count, status, waste-in-place, design capacity) and
 * USPVDB solar capacity + install-year cohorts.
 *
 * An earlier version reported an "acceptance probability" from an arbitrary
 * multiplier and an average disposal cost from two hardcoded dollar constants.
 * Neither had a data source, so both are gone. What remains is either measured
 * or a documented model (see pv-waste.ts) labelled as such in the UI.
 */
import type { Landfill } from "@/types/landfill";
import type { SolarCohort, SolarStateStats } from "@/types/solar";
import { projectWaste, tonnesRetiringWithin } from "@/lib/pv-waste";

export interface StateCoverage {
  state: string;
  /** Open MSW landfills in the state (EPA LMOP). */
  landfillCount: number;
  /** Installed utility-scale solar capacity (USPVDB). */
  solarMw: number;
  /**
   * Open landfills per GW of installed solar — a measured disposal-density ratio.
   * Low values mean a large fleet with few places to send its modules. Replaces
   * the previous "acceptance probability", which had no data source.
   */
  landfillsPerGw: number;
  /** Remaining permitted headroom in tons, where LMOP reports both figures. */
  remainingCapacityTons: number | null;
  /**
   * Modelled tonnage retiring within the projection horizon (see pv-waste.ts).
   * The horizon is 30 years, not 10: modules retire ~30y after install and the
   * US fleet averages under 10 years old, so a 10-year window is near-empty and
   * hides the actual retirement wave in the 2040s-50s.
   */
  projectedWasteTonnes: number;
  /** Year with the largest modelled retirement tonnage, or null if none. */
  peakRetirementYear: number | null;
  /**
   * Modelled PV waste over the horizon as a share of remaining landfill headroom (%).
   * null when LMOP does not report enough capacity data for the state.
   */
  wasteToCapacityPct: number | null;
  nearestFacility: string;
  nearestDistance: number;
  /** Few open landfills, or the nearest one is far from the state's solar fleet. */
  wasteDesert: boolean;
}

const EARTH_RADIUS_MILES = 3958.8;

/** Projection horizon for retirement tonnage. See projectedWasteTonnes above. */
export const WASTE_HORIZON_YEARS = 30;

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

/**
 * Remaining permitted headroom = design capacity - waste already in place,
 * summed over open landfills that report both. Returns null when none do.
 */
export function computeRemainingCapacityTons(openLandfills: Landfill[]): number | null {
  let total = 0;
  let reporting = 0;
  for (const l of openLandfills) {
    if (l.designCapacityTons != null && l.wasteInPlaceTons != null) {
      total += Math.max(0, l.designCapacityTons - l.wasteInPlaceTons);
      reporting += 1;
    }
  }
  return reporting > 0 ? Math.round(total) : null;
}

export function isWasteDesert(
  landfillCount: number,
  nearestDistance: number,
  solarMw: number,
): boolean {
  return landfillCount < 3 || (nearestDistance > 100 && solarMw > 500);
}

function stateReferencePoint(landfillsInState: Landfill[]): { lat: number; lng: number } | null {
  const openInState = landfillsInState.filter(isOpenLandfill);
  const source = openInState.length > 0 ? openInState : landfillsInState;
  if (source.length === 0) return null;
  return {
    lat: source.reduce((sum, l) => sum + l.lat, 0) / source.length,
    lng: source.reduce((sum, l) => sum + l.lng, 0) / source.length,
  };
}

function findNearestOpenLandfill(
  point: { lat: number; lng: number },
  openLandfills: Landfill[],
): { facility: Landfill; distance: number } | null {
  let nearest: { facility: Landfill; distance: number } | null = null;
  for (const landfill of openLandfills) {
    const distance = haversineMiles(point.lat, point.lng, landfill.lat, landfill.lng);
    if (!nearest || distance < nearest.distance) nearest = { facility: landfill, distance };
  }
  return nearest;
}

export function computeStateCoverage(
  landfills: Landfill[],
  solarStats: SolarStateStats[],
  cohorts: SolarCohort[] = [],
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
      const remainingCapacityTons = computeRemainingCapacityTons(openInState);
      const projectedWasteTonnes = tonnesRetiringWithin(cohorts, WASTE_HORIZON_YEARS, stats.state);
      const curve = projectWaste(cohorts, { state: stats.state, horizonYears: WASTE_HORIZON_YEARS });
      const peak = curve.reduce<{ year: number; t: number } | null>(
        (best, pt) => (pt.retiringTonnes > (best?.t ?? 0) ? { year: pt.year, t: pt.retiringTonnes } : best),
        null,
      );
      const wasteToCapacityPct =
        remainingCapacityTons && remainingCapacityTons > 0
          ? Math.round((projectedWasteTonnes / remainingCapacityTons) * 10000) / 100
          : null;

      const reference = stateReferencePoint(landfillsInState);
      let nearestFacility = "No open landfill nearby";
      let nearestDistance = Number.POSITIVE_INFINITY;
      if (reference) {
        const nearest = findNearestOpenLandfill(reference, openLandfills);
        if (nearest) {
          nearestFacility = nearest.facility.name;
          nearestDistance = Math.round(nearest.distance);
        }
      }
      if (!Number.isFinite(nearestDistance)) nearestDistance = 999;

      return {
        state: stats.state,
        landfillCount,
        solarMw: stats.totalCapacityMw,
        landfillsPerGw:
          stats.totalCapacityMw > 0
            ? Math.round((landfillCount / (stats.totalCapacityMw / 1000)) * 100) / 100
            : landfillCount,
        remainingCapacityTons,
        projectedWasteTonnes,
        peakRetirementYear: peak?.year ?? null,
        wasteToCapacityPct,
        nearestFacility,
        nearestDistance,
        wasteDesert: isWasteDesert(landfillCount, nearestDistance, stats.totalCapacityMw),
      };
    })
    .sort((a, b) => b.solarMw - a.solarMw);
}
