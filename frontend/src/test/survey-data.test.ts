import { readFileSync } from "fs";
import path from "path";
import { describe, it, expect, beforeEach } from "vitest";
import type { Landfill } from "@/types/landfill";
import {
  parseSurveyCSV,
  enrichLandfillsWithSurvey,
  resetSurveyCache,
  setSurveyCache,
} from "@/lib/survey-data";

const CSV_PATH = path.resolve(__dirname, "../../public/data/pv-survey.csv");

function makeLandfill(overrides: Partial<Landfill> = {}): Landfill {
  return {
    id: "1",
    name: "City of Clovis LF",
    state: "CA",
    county: "Fresno",
    lat: 36.8,
    lng: -119.7,
    ownership: "Municipal",
    acceptsPV: "Unknown",
    tippingFee: null,
    tippingFeeUnit: "$/ton",
    minLoad: null,
    tclpRequired: false,
    notes: "Source: U.S. EPA LMOP database.",
    lastSurveyed: "",
    surveyorName: "",
    ...overrides,
  };
}

describe("parseSurveyCSV", () => {
  it("parses the bundled PV survey CSV", () => {
    const csv = readFileSync(CSV_PATH, "utf-8");
    const records = parseSurveyCSV(csv);

    expect(records.length).toBe(15);
    expect(records[0]).toMatchObject({
      name: "City of Clovis LF",
      state: "CA",
      acceptsPV: "Yes",
      tippingFee: 95.5,
      tclpRequired: true,
      surveyorName: "M. Patel",
    });
  });

  it("handles empty tipping fees and boolean flags", () => {
    const csv = [
      "name,state,acceptsPV,tippingFee,tclpRequired,notes,lastSurveyed,surveyorName",
      "Test LF,FL,No,,false,No PV accepted.,2024-01-01,A. Tester",
    ].join("\n");

    expect(parseSurveyCSV(csv)).toEqual([
      {
        name: "Test LF",
        state: "FL",
        acceptsPV: "No",
        tippingFee: null,
        tclpRequired: false,
        notes: "No PV accepted.",
        lastSurveyed: "2024-01-01",
        surveyorName: "A. Tester",
      },
    ]);
  });

  it("throws on invalid headers", () => {
    expect(() => parseSurveyCSV("bad,header\nx,y")).toThrow(/Invalid PV survey CSV header/);
  });
});

describe("enrichLandfillsWithSurvey", () => {
  beforeEach(() => {
    resetSurveyCache();
  });

  it("merges survey fields into matching landfills by name and state", () => {
    setSurveyCache([
      {
        name: "City of Clovis LF",
        state: "CA",
        acceptsPV: "Yes",
        tippingFee: 95.5,
        tclpRequired: true,
        notes: "Accepts bifacial modules.",
        lastSurveyed: "2025-03-14",
        surveyorName: "M. Patel",
      },
    ]);

    const [enriched] = enrichLandfillsWithSurvey([makeLandfill()]);
    expect(enriched).toMatchObject({
      acceptsPV: "Yes",
      tippingFee: 95.5,
      tclpRequired: true,
      lastSurveyed: "2025-03-14",
      surveyorName: "M. Patel",
      notes: expect.stringContaining("Survey: Accepts bifacial modules."),
    });
  });

  it("leaves unmatched landfills unchanged", () => {
    setSurveyCache([
      {
        name: "Other Landfill",
        state: "TX",
        acceptsPV: "No",
        tippingFee: 50,
        tclpRequired: false,
        notes: "N/A",
        lastSurveyed: "2025-01-01",
        surveyorName: "X",
      },
    ]);

    const original = makeLandfill({ name: "Unmatched LF", state: "NV" });
    const [result] = enrichLandfillsWithSurvey([original]);
    expect(result).toEqual(original);
  });

  it("returns landfills unchanged when survey cache is empty", () => {
    const original = makeLandfill();
    expect(enrichLandfillsWithSurvey([original])).toEqual([original]);
  });

  it("enriches multiple states from bundled CSV sample", () => {
    const csv = readFileSync(CSV_PATH, "utf-8");
    setSurveyCache(parseSurveyCSV(csv));

    const landfills = [
      makeLandfill({ id: "1", name: "NJMC 1-E Landfill", state: "NJ" }),
      makeLandfill({ id: "2", name: "Carson City Sanitary Landfill", state: "NV" }),
      makeLandfill({ id: "3", name: "Broward County Landfill", state: "FL" }),
    ];

    const enriched = enrichLandfillsWithSurvey(landfills);
    expect(enriched[0].acceptsPV).toBe("Unknown");
    expect(enriched[1].acceptsPV).toBe("Yes");
    expect(enriched[2].acceptsPV).toBe("No");
  });
});
