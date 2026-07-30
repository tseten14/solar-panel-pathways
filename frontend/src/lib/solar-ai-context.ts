// Builds the Solar-AI fact_ledger + quick-action set from data already loaded on
// the Dashboard (EPA landfill stats, USGS solar capacity, modelled trade flows,
// detection coverage). Mirrors ndc-data-explorer's dashboard-ai-context.ts: the
// backend stays a thin, stateless prompt-stuffing relay, so ledger construction
// lives here where the app's data hooks already are.
import type { Landfill } from "@/types/landfill";
import type { SolarStateStats } from "@/types/solar";
import type { ModelledTradeRoute } from "@/lib/trade-flows";
import type { DetectionStats } from "@/lib/solar-scan-api";

export interface SolarAiFact {
  id: string;
  value: number | null;
  source_label: string;
  source_url: string;
  domain: string;
  claim: string;
}

export interface SolarAiQuickAction {
  type: "landfill_overview" | "solar_capacity_gap" | "trade_flow_summary" | "detection_progress";
  label: string;
  description: string;
}

export const SOLAR_QUICK_ACTIONS: SolarAiQuickAction[] = [
  {
    type: "landfill_overview",
    label: "Landfill overview",
    description: "Status, states, and waste volume of tracked MSW landfills",
  },
  {
    type: "solar_capacity_gap",
    label: "Solar capacity vs. landfills",
    description: "How utility solar capacity compares to landfill PV-waste volume",
  },
  {
    type: "trade_flow_summary",
    label: "Trade flow summary",
    description: "Which modelled interstate PV-waste routes are largest",
  },
  {
    type: "detection_progress",
    label: "Detection coverage",
    description: "How much satellite area has been scanned and confirmed",
  },
];

const EPA_LMOP_URL = "https://www.epa.gov/lmop";
const USGS_USPVDB_URL = "https://www.usgs.gov/apps/uspvdb/";

export function buildSolarAiContext(
  landfills: Landfill[],
  solarStats: SolarStateStats[],
  tradeRoutes: ModelledTradeRoute[],
  detectionStats: DetectionStats | null,
): { fact_ledger: SolarAiFact[] } {
  const openLandfills = landfills.filter((l) => l.operationalStatus === "Open");
  const stateCount = new Set(landfills.map((l) => l.state).filter((s) => s !== "—")).size;
  const totalSolarMw = Math.round(solarStats.reduce((s, r) => s + r.totalCapacityMw, 0));
  const totalSolarFacilities = solarStats.reduce((s, r) => s + r.facilityCount, 0);
  const topRoute = [...tradeRoutes].sort((a, b) => b.estimatedVolumeTons - a.estimatedVolumeTons)[0];
  const topSolarState = [...solarStats].sort((a, b) => b.totalCapacityMw - a.totalCapacityMw)[0];

  const facts: SolarAiFact[] = [
    {
      id: "fact_landfill_total_count",
      value: landfills.length,
      source_label: "EPA LMOP",
      source_url: EPA_LMOP_URL,
      domain: "epa.gov",
      claim: `${landfills.length} total MSW landfills tracked across ${stateCount} states/territories`,
    },
    {
      id: "fact_landfill_open_count",
      value: openLandfills.length,
      source_label: "EPA LMOP",
      source_url: EPA_LMOP_URL,
      domain: "epa.gov",
      claim: `${openLandfills.length} open MSW landfills tracked`,
    },
    {
      id: "fact_landfill_state_count",
      value: stateCount,
      source_label: "EPA LMOP",
      source_url: EPA_LMOP_URL,
      domain: "epa.gov",
      claim: `Tracked landfills span ${stateCount} states/territories`,
    },
    {
      id: "fact_solar_total_mw",
      value: totalSolarMw,
      source_label: "USGS USPVDB",
      source_url: USGS_USPVDB_URL,
      domain: "usgs.gov",
      claim: `${totalSolarMw} MW of tracked utility-scale solar capacity`,
    },
    {
      id: "fact_solar_facility_count",
      value: totalSolarFacilities,
      source_label: "USGS USPVDB",
      source_url: USGS_USPVDB_URL,
      domain: "usgs.gov",
      claim: `${totalSolarFacilities} utility-scale solar facilities tracked`,
    },
    {
      id: "fact_trade_route_count",
      value: tradeRoutes.length,
      source_label: "SolarTrace modelled trade flows",
      source_url: "/trade-flows",
      domain: "solartrace.app",
      claim: `${tradeRoutes.length} modelled interstate PV-waste trade routes`,
    },
  ];

  if (topSolarState) {
    facts.push({
      id: "fact_solar_top_state_mw",
      value: Math.round(topSolarState.totalCapacityMw),
      source_label: "USGS USPVDB",
      source_url: USGS_USPVDB_URL,
      domain: "usgs.gov",
      claim: `${topSolarState.state} leads with ${Math.round(topSolarState.totalCapacityMw)} MW of tracked solar capacity`,
    });
  }

  if (topRoute) {
    facts.push({
      id: "fact_trade_top_route_tons",
      value: Math.round(topRoute.estimatedVolumeTons),
      source_label: "SolarTrace modelled trade flows",
      source_url: "/trade-flows",
      domain: "solartrace.app",
      claim: `Largest modelled route (${topRoute.origin} to ${topRoute.destination}) moves an estimated ${Math.round(topRoute.estimatedVolumeTons)} tons/yr`,
    });
  }

  if (detectionStats) {
    facts.push(
      {
        id: "fact_coverage_scanned_km2",
        value: detectionStats.scanned_area_km2,
        source_label: "SolarTrace satellite detection",
        source_url: "/solar-map",
        domain: "solartrace.app",
        claim: `${detectionStats.scanned_area_km2} km² scanned for solar arrays via satellite detection`,
      },
      {
        id: "fact_coverage_confirmed_count",
        value: detectionStats.confirmed,
        source_label: "SolarTrace satellite detection",
        source_url: "/solar-map",
        domain: "solartrace.app",
        claim: `${detectionStats.confirmed} solar array detections confirmed by review`,
      },
      {
        id: "fact_coverage_pending_count",
        value: detectionStats.pending,
        source_label: "SolarTrace satellite detection",
        source_url: "/solar-map",
        domain: "solartrace.app",
        claim: `${detectionStats.pending} solar array detections awaiting review`,
      },
    );
  }

  return { fact_ledger: facts };
}
