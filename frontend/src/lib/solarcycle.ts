/**
 * SolarCycle's landfill phone survey: which landfills in AZ, NV, TX and NM
 * will take end-of-life solar panels, and what they charge.
 *
 * Columns are read by header name, not position, so a newer export with more
 * rows or reordered columns still loads. Many rows are only a state and a name
 * — those sites were listed but not yet called.
 */

export type PvStatus = "accepts" | "declines" | "unknown" | "not_surveyed";

export const PV_STATUS_LABEL: Record<PvStatus, string> = {
  accepts: "Accepts PV",
  declines: "Does not accept",
  unknown: "Unclear / no answer",
  not_surveyed: "Not yet surveyed",
};

export const PV_STATUS_ORDER: PvStatus[] = ["accepts", "declines", "unknown", "not_surveyed"];

export interface SurveySite {
  id: string;
  state: string;
  name: string;
  type: string | null;
  pvStatus: PvStatus;
  /** The survey's own wording, e.g. "Yes (See notes)". */
  pvRaw: string;
  acceptLqg: string | null;
  restrictions: string | null;
  owner: string | null;
  phone: string | null;
  altContact: string | null;
  location: string | null;
  website: string | null;
  /** Disposal price as of July 2024, in dollars per `costPer` `costUnit`. */
  cost: number | null;
  costPer: string | null;
  costUnit: string | null;
  costPerPanel: number | null;
  usedInCalc: string | null;
  callNotes: string | null;
  notes: string | null;
}

/** RFC 4180-style CSV: quoted fields may contain commas, quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function normalisePvStatus(raw: string): PvStatus {
  const v = raw.trim().toLowerCase();
  if (!v) return "not_surveyed";
  if (v.startsWith("yes")) return "accepts";
  if (v.startsWith("no")) return "declines";
  return "unknown";
}

export function normaliseType(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v.startsWith("private")) return "Private";
  if (v.startsWith("muni")) return "Municipal";
  if (v.startsWith("county")) return "County-run";
  if (v.startsWith("state")) return "State-run";
  return raw.trim();
}

function text(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function num(v: string | undefined): number | null {
  const t = v?.replace(/[$,]/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function parseSurvey(csvText: string): SurveySite[] {
  const [header, ...rows] = parseCsv(csvText);
  if (!header) return [];
  const index = new Map(header.map((h, i) => [h.trim().toLowerCase(), i]));
  const col = (row: string[], ...names: string[]) => {
    for (const n of names) {
      const i = index.get(n.toLowerCase());
      if (i !== undefined) return row[i];
    }
    return undefined;
  };
  // Some rows run past the named columns; keep that text with the notes.
  const namedCount = header.filter((h) => h.trim() !== "").length;

  return rows
    .map((row, i): SurveySite | null => {
      const name = text(col(row, "Landfill Name"));
      const state = text(col(row, "State"));
      if (!name || !state) return null;
      const pvRaw = col(row, "PV OK?")?.trim() ?? "";
      const overflow = row.slice(namedCount).map((c) => c.trim()).filter(Boolean);
      const notes = [text(col(row, "Notes")), ...overflow].filter(Boolean).join(" · ") || null;

      return {
        id: `${i}-${state}-${name}`,
        state: state.toUpperCase(),
        name,
        type: normaliseType(col(row, "Type") ?? ""),
        pvStatus: normalisePvStatus(pvRaw),
        pvRaw,
        acceptLqg: text(col(row, "Accept LQG?")),
        restrictions: text(col(row, "Restrictions")),
        owner: text(col(row, "Owner/Operator")),
        phone: text(col(row, "Contact Phone", "Contant Phone")),
        altContact: text(col(row, "Contact 2")),
        location: text(col(row, "Location")),
        website: text(col(row, "Website")),
        cost: num(col(row, "Cost (as of July 2024)", "Cost")),
        costPer: text(col(row, "Per")),
        costUnit: text(col(row, "Unit")),
        costPerPanel: num(col(row, "Per Panel")),
        usedInCalc: text(col(row, "Used in Calc?")),
        callNotes: text(col(row, "Internal Call Notes")),
        notes,
      };
    })
    .filter((s): s is SurveySite => s !== null);
}

export interface StateBreakdown {
  state: string;
  total: number;
  accepts: number;
  declines: number;
  unknown: number;
  not_surveyed: number;
}

export function summariseByState(sites: SurveySite[]): StateBreakdown[] {
  const byState = new Map<string, StateBreakdown>();
  for (const s of sites) {
    const row =
      byState.get(s.state) ??
      { state: s.state, total: 0, accepts: 0, declines: 0, unknown: 0, not_surveyed: 0 };
    row.total++;
    row[s.pvStatus]++;
    byState.set(s.state, row);
  }
  return [...byState.values()].sort((a, b) => b.total - a.total);
}

export function summariseByType(sites: SurveySite[]): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of sites) if (s.type) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
  return [...counts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
}

/** The survey in the field names the assistant's prompt describes. */
export function toAssistantRows(sites: SurveySite[]) {
  return sites.map((s) => ({
    state: s.state,
    name: s.name,
    type: s.type,
    pv_status: s.pvStatus,
    pv_raw: s.pvRaw,
    accept_lqg: s.acceptLqg,
    restrictions: s.restrictions,
    owner: s.owner,
    phone: s.phone,
    alt_contact: s.altContact,
    location: s.location,
    website: s.website,
    cost: s.cost,
    cost_per: s.costPer,
    cost_unit: s.costUnit,
    cost_per_panel: s.costPerPanel,
    call_notes: s.callNotes,
    notes: s.notes,
  }));
}

/** Sites with a quoted per-panel price, cheapest first. */
export function pricedSites(sites: SurveySite[]): SurveySite[] {
  return sites
    .filter((s) => s.costPerPanel != null && s.costPerPanel > 0)
    .sort((a, b) => a.costPerPanel! - b.costPerPanel!);
}
