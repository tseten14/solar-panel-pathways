import { queryArcGISFeatures } from "@/lib/arcgis";
import type { Landfill } from "@/types/landfill";

const LMOP_URL =
  "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/New_Landfills/FeatureServer/0/query";

interface LmopAttributes {
  OBJECTID: number;
  landfill_name: string | null;
  county_state: string | null;
  landfill_owner_org: string | null;
  current_landfill_status: string | null;
  latitude: number | null;
  longitude: number | null;
  landfill_design_cap: number | null;
  waste_in_place_tons: number | null;
}

export function parseCountyState(countyState: string | null): { county: string; state: string } {
  if (!countyState) return { county: "Unknown", state: "—" };
  const parts = countyState.split(",").map((p) => p.trim());
  if (parts.length >= 2) {
    return { county: parts.slice(0, -1).join(", "), state: parts[parts.length - 1] };
  }
  return { county: countyState, state: "—" };
}

export function inferOwnership(ownerOrg: string | null): Landfill["ownership"] {
  if (!ownerOrg) return "Private";
  const lower = ownerOrg.toLowerCase();
  if (
    lower.includes("county") ||
    lower.includes("parish") ||
    lower.includes("city of") ||
    lower.includes("municipal") ||
    lower.includes("authority") ||
    lower.includes("solid waste district")
  ) {
    return "Municipal";
  }
  return "Private";
}

export function mapLmopFeature(feature: { attributes: LmopAttributes }): Landfill | null {
  const a = feature.attributes;
  const lat = a.latitude;
  const lng = a.longitude;
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return null;

  const { county, state } = parseCountyState(a.county_state);
  const status = a.current_landfill_status ?? "Unknown";
  const capNote =
    a.landfill_design_cap != null ? `Design capacity: ${a.landfill_design_cap.toLocaleString()} tons.` : "";
  const wasteNote =
    a.waste_in_place_tons != null ? `Waste in place: ${a.waste_in_place_tons.toLocaleString()} tons.` : "";

  return {
    id: String(a.OBJECTID),
    name: a.landfill_name?.trim() || "Unnamed Landfill",
    state,
    county,
    lat,
    lng,
    ownership: inferOwnership(a.landfill_owner_org),
    acceptsPV: "Unknown",
    tippingFee: null,
    tippingFeeUnit: "$/ton",
    minLoad: null,
    tclpRequired: false,
    notes: [status !== "Unknown" ? `Status: ${status}.` : "", capNote, wasteNote, "Source: U.S. EPA LMOP database."]
      .filter(Boolean)
      .join(" "),
    lastSurveyed: "",
    surveyorName: "",
    operationalStatus: status,
    source: "EPA LMOP",
  };
}

export async function fetchLandfills(): Promise<Landfill[]> {
  const features = await queryArcGISFeatures<LmopAttributes>(LMOP_URL, {
    where: "latitude IS NOT NULL AND longitude IS NOT NULL",
    outFields:
      "OBJECTID,landfill_name,county_state,landfill_owner_org,current_landfill_status,latitude,longitude,landfill_design_cap,waste_in_place_tons",
    returnGeometry: "false",
  });

  return features.map(mapLmopFeature).filter((l): l is Landfill => l !== null);
}
