import type { Landfill } from "@/types/landfill";

export interface SurveyRecord {
  name: string;
  state: string;
  acceptsPV: Landfill["acceptsPV"];
  tippingFee: number | null;
  tclpRequired: boolean;
  notes: string;
  lastSurveyed: string;
  surveyorName: string;
}

const SURVEY_URL = "/data/pv-survey.csv";
const ACCEPTS_PV_VALUES: Landfill["acceptsPV"][] = ["Yes", "No", "Conditional", "Unknown"];

let cachedSurvey: SurveyRecord[] | null = null;

/** Parse a CSV line handling quoted fields */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else current += c;
  }
  result.push(current.trim());
  return result;
}

function parseBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

function parseAcceptsPV(value: string): Landfill["acceptsPV"] {
  const trimmed = value.trim();
  if (ACCEPTS_PV_VALUES.includes(trimmed as Landfill["acceptsPV"])) {
    return trimmed as Landfill["acceptsPV"];
  }
  return "Unknown";
}

function surveyKey(name: string, state: string): string {
  return `${name.trim().toLowerCase()}|${state.trim().toUpperCase()}`;
}

/** Parse PV survey CSV text into structured records */
export function parseSurveyCSV(text: string): SurveyRecord[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];

  const header = parseCSVLine(lines[0]);
  const idx = {
    name: header.indexOf("name"),
    state: header.indexOf("state"),
    acceptsPV: header.indexOf("acceptsPV"),
    tippingFee: header.indexOf("tippingFee"),
    tclpRequired: header.indexOf("tclpRequired"),
    notes: header.indexOf("notes"),
    lastSurveyed: header.indexOf("lastSurveyed"),
    surveyorName: header.indexOf("surveyorName"),
  };

  if (Object.values(idx).some((i) => i === -1)) {
    throw new Error(`Invalid PV survey CSV header: ${lines[0]}`);
  }

  const records: SurveyRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    const name = row[idx.name] ?? "";
    const state = row[idx.state] ?? "";
    if (!name || !state) continue;

    const feeRaw = row[idx.tippingFee]?.trim() ?? "";
    const tippingFee = feeRaw === "" ? null : parseFloat(feeRaw);

    records.push({
      name,
      state,
      acceptsPV: parseAcceptsPV(row[idx.acceptsPV] ?? ""),
      tippingFee: tippingFee != null && !Number.isNaN(tippingFee) ? tippingFee : null,
      tclpRequired: parseBoolean(row[idx.tclpRequired] ?? ""),
      notes: row[idx.notes] ?? "",
      lastSurveyed: row[idx.lastSurveyed] ?? "",
      surveyorName: row[idx.surveyorName] ?? "",
    });
  }
  return records;
}

function buildSurveyMap(records: SurveyRecord[]): Map<string, SurveyRecord> {
  const map = new Map<string, SurveyRecord>();
  for (const record of records) {
    map.set(surveyKey(record.name, record.state), record);
  }
  return map;
}

/** Fetch and cache PV survey data from /data/pv-survey.csv */
export async function loadSurveyData(): Promise<SurveyRecord[]> {
  if (cachedSurvey) return cachedSurvey;

  const res = await fetch(SURVEY_URL);
  if (!res.ok) throw new Error(`Failed to load PV survey data: ${res.status}`);
  cachedSurvey = parseSurveyCSV(await res.text());
  return cachedSurvey;
}

/** Merge survey responses into EPA LMOP landfill records (by name + state) */
export function enrichLandfillsWithSurvey(landfills: Landfill[], survey?: SurveyRecord[]): Landfill[] {
  const records = survey ?? cachedSurvey;
  if (!records?.length) return landfills;

  const surveyMap = buildSurveyMap(records);
  return landfills.map((landfill) => {
    const match = surveyMap.get(surveyKey(landfill.name, landfill.state));
    if (!match) return landfill;

    const surveyNote = match.notes ? `Survey: ${match.notes}` : "";
    const notes = [landfill.notes, surveyNote].filter(Boolean).join(" ");

    return {
      ...landfill,
      acceptsPV: match.acceptsPV,
      tippingFee: match.tippingFee,
      tclpRequired: match.tclpRequired,
      notes,
      lastSurveyed: match.lastSurveyed,
      surveyorName: match.surveyorName,
    };
  });
}

/** Reset cached survey data (for tests) */
export function resetSurveyCache(): void {
  cachedSurvey = null;
}

/** Seed survey cache directly (for tests) */
export function setSurveyCache(records: SurveyRecord[]): void {
  cachedSurvey = records;
}
