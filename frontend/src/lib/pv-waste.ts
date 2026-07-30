/**
 * PV end-of-life waste projection, built entirely from real USPVDB install-year
 * cohorts (`p_year`) and capacity (`p_cap_dc`).
 *
 * The model constants below are published industry figures, cited inline. They are
 * assumptions — but they are *sourced* assumptions applied to real capacity data,
 * and every number this module produces is labelled "modelled" in the UI. It
 * replaces an earlier version of this dashboard that reported invented tipping
 * fees and an arbitrary "acceptance probability" as if they were measured.
 */
import type { SolarCohort, SolarTechMix } from "@/types/solar";

/**
 * Module mass per MW of DC capacity. IRENA/IEA-PVPS "End-of-Life Management:
 * Solar Photovoltaic Panels" (2016) puts a utility-scale c-Si system at roughly
 * 60-75 t of module mass per MW; 60 t/MW is the conservative end and excludes
 * racking, inverters and cabling (module glass/silicon/frame only).
 */
export const TONNES_PER_MW = 60;

/**
 * Regular-loss lifetime. IRENA models a 30-year expected module lifetime, with an
 * "early-loss" scenario for failures before then. We report the regular-loss case.
 */
export const PANEL_LIFETIME_YEARS = 30;

/** Chemistry buckets we can distinguish from USPVDB `p_tech_sec`. */
export type HazardClass = "crystalline-silicon" | "thin-film" | "mixed" | "unknown";

export function classifyTech(tech: string): HazardClass {
  const t = tech.toLowerCase();
  const hasCsi = t.includes("c-si");
  const hasThin = t.includes("thin-film");
  if (hasCsi && hasThin) return "mixed";
  if (hasThin) return "thin-film";
  if (hasCsi) return "crystalline-silicon";
  return "unknown";
}

/** Primary contaminant of concern for each chemistry, for TCLP/disposal context. */
export const HAZARD_NOTE: Record<HazardClass, string> = {
  "crystalline-silicon": "Lead solder — TCLP lead is the usual disposal trigger",
  "thin-film": "Cadmium telluride — TCLP cadmium is the usual disposal trigger",
  mixed: "Mixed chemistry — both lead and cadmium may apply",
  unknown: "Chemistry not reported in USPVDB",
};

export interface WasteProjectionPoint {
  year: number;
  /** Capacity reaching end of life that year (MW), from the cohort installed 30y earlier. */
  retiringMw: number;
  /** Modelled module tonnage reaching end of life that year. */
  retiringTonnes: number;
  /** Running total of tonnes retired up to and including this year. */
  cumulativeTonnes: number;
}

/**
 * Project annual end-of-life tonnage by shifting each real install-year cohort
 * forward by the expected module lifetime.
 */
export function projectWaste(
  cohorts: SolarCohort[],
  opts: { state?: string; horizonYears?: number } = {},
): WasteProjectionPoint[] {
  const { state, horizonYears = 30 } = opts;
  const relevant = state && state !== "all" ? cohorts.filter((c) => c.state === state) : cohorts;
  if (relevant.length === 0) return [];

  const mwRetiringInYear = new Map<number, number>();
  for (const c of relevant) {
    const retireYear = c.year + PANEL_LIFETIME_YEARS;
    mwRetiringInYear.set(retireYear, (mwRetiringInYear.get(retireYear) ?? 0) + c.capacityMw);
  }

  const thisYear = new Date().getFullYear();
  const years = [...mwRetiringInYear.keys()].sort((a, b) => a - b);
  const lastYear = Math.min(years[years.length - 1], thisYear + horizonYears);

  const out: WasteProjectionPoint[] = [];
  let cumulative = 0;
  for (let y = years[0]; y <= lastYear; y++) {
    const mw = mwRetiringInYear.get(y) ?? 0;
    const tonnes = mw * TONNES_PER_MW;
    cumulative += tonnes;
    out.push({
      year: y,
      retiringMw: Math.round(mw * 10) / 10,
      retiringTonnes: Math.round(tonnes),
      cumulativeTonnes: Math.round(cumulative),
    });
  }
  return out;
}

/** Total modelled tonnage that will retire within `withinYears` from now. */
export function tonnesRetiringWithin(
  cohorts: SolarCohort[],
  withinYears: number,
  state?: string,
): number {
  const thisYear = new Date().getFullYear();
  return projectWaste(cohorts, { state, horizonYears: withinYears })
    .filter((p) => p.year >= thisYear && p.year <= thisYear + withinYears)
    .reduce((sum, p) => sum + p.retiringTonnes, 0);
}

/** Weighted-average age of installed capacity (years), from real cohort data. */
export function averageFleetAge(cohorts: SolarCohort[], state?: string): number | null {
  const relevant = state && state !== "all" ? cohorts.filter((c) => c.state === state) : cohorts;
  const totalMw = relevant.reduce((s, c) => s + c.capacityMw, 0);
  if (totalMw <= 0) return null;
  const thisYear = new Date().getFullYear();
  const weighted = relevant.reduce((s, c) => s + c.capacityMw * (thisYear - c.year), 0);
  return Math.round((weighted / totalMw) * 10) / 10;
}

export interface HazardSplit {
  hazardClass: HazardClass;
  capacityMw: number;
  facilityCount: number;
  shareOfMw: number;
  note: string;
}

/** Collapse USPVDB's raw `p_tech_sec` strings into hazard classes with shares. */
export function summariseHazard(techMix: SolarTechMix[]): HazardSplit[] {
  const totalMw = techMix.reduce((s, t) => s + t.capacityMw, 0);
  const buckets = new Map<HazardClass, { mw: number; n: number }>();
  for (const t of techMix) {
    const cls = classifyTech(t.tech);
    const cur = buckets.get(cls) ?? { mw: 0, n: 0 };
    cur.mw += t.capacityMw;
    cur.n += t.facilityCount;
    buckets.set(cls, cur);
  }
  return [...buckets.entries()]
    .map(([hazardClass, v]) => ({
      hazardClass,
      capacityMw: Math.round(v.mw),
      facilityCount: v.n,
      shareOfMw: totalMw > 0 ? Math.round((v.mw / totalMw) * 1000) / 10 : 0,
      note: HAZARD_NOTE[hazardClass],
    }))
    .sort((a, b) => b.capacityMw - a.capacityMw);
}
