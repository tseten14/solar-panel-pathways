import { describe, it, expect } from "vitest";
import type { SolarCohort, SolarTechMix } from "@/types/solar";
import {
  PANEL_LIFETIME_YEARS,
  TONNES_PER_MW,
  averageFleetAge,
  classifyTech,
  projectWaste,
  summariseHazard,
  tonnesRetiringWithin,
} from "@/lib/pv-waste";

const thisYear = new Date().getFullYear();

function cohort(state: string, year: number, capacityMw: number): SolarCohort {
  return { state, year, capacityMw, facilityCount: 1 };
}

describe("projectWaste", () => {
  it("shifts each install cohort forward by the module lifetime", () => {
    const curve = projectWaste([cohort("CA", 2000, 10)]);
    const retireYear = 2000 + PANEL_LIFETIME_YEARS;
    const point = curve.find((p) => p.year === retireYear);
    expect(point).toBeDefined();
    expect(point!.retiringMw).toBe(10);
    expect(point!.retiringTonnes).toBe(10 * TONNES_PER_MW);
  });

  it("accumulates tonnage across cohorts", () => {
    const curve = projectWaste([cohort("CA", 2000, 10), cohort("CA", 2001, 5)]);
    const last = curve[curve.length - 1];
    expect(last.cumulativeTonnes).toBe(15 * TONNES_PER_MW);
  });

  it("filters to a single state when asked", () => {
    const cohorts = [cohort("CA", 2000, 10), cohort("TX", 2000, 99)];
    const curve = projectWaste(cohorts, { state: "CA" });
    const point = curve.find((p) => p.year === 2000 + PANEL_LIFETIME_YEARS);
    expect(point!.retiringMw).toBe(10);
  });

  it("returns an empty curve when there is no matching capacity", () => {
    expect(projectWaste([], {})).toEqual([]);
    expect(projectWaste([cohort("CA", 2000, 10)], { state: "TX" })).toEqual([]);
  });
});

describe("tonnesRetiringWithin", () => {
  it("counts only cohorts retiring inside the window", () => {
    // Installed so that it retires 5 years from now, and one that retires far later.
    const soon = cohort("CA", thisYear - PANEL_LIFETIME_YEARS + 5, 10);
    const later = cohort("CA", thisYear - PANEL_LIFETIME_YEARS + 25, 10);
    expect(tonnesRetiringWithin([soon, later], 10, "CA")).toBe(10 * TONNES_PER_MW);
  });

  it("excludes capacity that already retired before now", () => {
    const past = cohort("CA", thisYear - PANEL_LIFETIME_YEARS - 5, 10);
    expect(tonnesRetiringWithin([past], 10, "CA")).toBe(0);
  });
});

describe("averageFleetAge", () => {
  it("weights age by capacity, not plant count", () => {
    // 90 MW installed 10y ago, 10 MW installed 30y ago -> weighted toward 10y.
    const cohorts = [cohort("CA", thisYear - 10, 90), cohort("CA", thisYear - 30, 10)];
    expect(averageFleetAge(cohorts, "CA")).toBeCloseTo(12, 1);
  });

  it("returns null with no capacity", () => {
    expect(averageFleetAge([], "CA")).toBeNull();
  });
});

describe("classifyTech", () => {
  it("maps USPVDB p_tech_sec strings to hazard classes", () => {
    expect(classifyTech("c-si")).toBe("crystalline-silicon");
    expect(classifyTech("thin-film")).toBe("thin-film");
    expect(classifyTech("c-si,thin-film")).toBe("mixed");
    expect(classifyTech("missing")).toBe("unknown");
  });
});

describe("summariseHazard", () => {
  it("aggregates capacity share per hazard class", () => {
    const mix: SolarTechMix[] = [
      { tech: "c-si", facilityCount: 3, capacityMw: 75 },
      { tech: "thin-film", facilityCount: 1, capacityMw: 25 },
    ];
    const out = summariseHazard(mix);
    const csi = out.find((h) => h.hazardClass === "crystalline-silicon")!;
    const thin = out.find((h) => h.hazardClass === "thin-film")!;
    expect(csi.shareOfMw).toBe(75);
    expect(thin.shareOfMw).toBe(25);
    expect(csi.note).toMatch(/lead/i);
    expect(thin.note).toMatch(/cadmium/i);
  });
});
