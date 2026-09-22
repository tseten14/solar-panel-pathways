import { describe, it, expect } from "vitest";
import surveyCsv from "@/data/solarcycle-landfill-survey.csv?raw";
import {
  normalisePvStatus,
  normaliseType,
  parseCsv,
  parseSurvey,
  pricedSites,
  summariseByState,
} from "@/lib/solarcycle";

const HEADER =
  "State,Internal Call Notes,Landfill Name,Type,Accept LQG?,PV OK?,Restrictions,Owner/Operator,Contant Phone,Contact 2,Location,Website,Cost (as of July 2024),Per,Unit,Per Panel,Used in Calc?,Notes,";

describe("parseCsv", () => {
  it("keeps commas and escaped quotes inside quoted fields", () => {
    const rows = parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n');
    expect(rows).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
  });
});

describe("normalisation", () => {
  it("maps PV answers to statuses", () => {
    expect(normalisePvStatus("Yes")).toBe("accepts");
    expect(normalisePvStatus("Yes (See notes)")).toBe("accepts");
    expect(normalisePvStatus("No")).toBe("declines");
    expect(normalisePvStatus("?")).toBe("unknown");
    expect(normalisePvStatus("")).toBe("not_surveyed");
  });

  it("collapses landfill type spellings", () => {
    expect(normaliseType("Private landfill")).toBe("Private");
    expect(normaliseType("Private Landfill")).toBe("Private");
    expect(normaliseType("Muni Landfill")).toBe("Municipal");
    expect(normaliseType("Municipal")).toBe("Municipal");
    expect(normaliseType("")).toBeNull();
  });
});

describe("parseSurvey", () => {
  it("reads fields by header name, including quoted addresses and overflow notes", () => {
    const csv = [
      HEADER,
      'AZ,,Red Rock Landfill,Private Landfill,,Yes,None,Waste Connections,(480) 983-9101,,"22316 S. Harmon Rd, Florence, AZ 85132",,60,2000,lbs,2.1,1,,',
      "TX,,Charter Waste Landfill,Private Landfill,,Yes,,Republic Services,,,,,116.78,2000,lbs,4.0873,1,Reliable,No limits",
      "NV,,Ely,,,,,,,,,,,,,,,,",
    ].join("\n");
    const [red, charter, ely] = parseSurvey(csv);

    expect(red.location).toBe("22316 S. Harmon Rd, Florence, AZ 85132");
    expect(red.phone).toBe("(480) 983-9101");
    expect(red.cost).toBe(60);
    expect(red.costPerPanel).toBe(2.1);
    expect(red.pvStatus).toBe("accepts");
    expect(charter.notes).toBe("Reliable · No limits");
    expect(ely.pvStatus).toBe("not_surveyed");
    expect(ely.costPerPanel).toBeNull();
  });

  it("loads the bundled survey", () => {
    const sites = parseSurvey(surveyCsv);
    expect(sites.length).toBeGreaterThan(100);
    expect(summariseByState(sites).map((s) => s.state).sort()).toEqual(["AZ", "NM", "NV", "TX"]);
    const priced = pricedSites(sites);
    expect(priced.length).toBeGreaterThan(0);
    expect(priced[0].costPerPanel!).toBeLessThanOrEqual(priced[priced.length - 1].costPerPanel!);
  });
});
