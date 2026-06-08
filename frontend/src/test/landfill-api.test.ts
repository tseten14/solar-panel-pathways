import { describe, it, expect } from "vitest";
import { inferOwnership, mapLmopFeature, parseCountyState } from "@/lib/landfill-api";

describe("parseCountyState", () => {
  it("parses county and state from EPA format", () => {
    expect(parseCountyState("Acadia, LA")).toEqual({ county: "Acadia", state: "LA" });
    expect(parseCountyState("Los Angeles, CA")).toEqual({ county: "Los Angeles", state: "CA" });
  });

  it("handles missing values", () => {
    expect(parseCountyState(null)).toEqual({ county: "Unknown", state: "—" });
    expect(parseCountyState("")).toEqual({ county: "Unknown", state: "—" });
  });
});

describe("inferOwnership", () => {
  it("classifies municipal owners", () => {
    expect(inferOwnership("Acadia Parish Police Jury, LA")).toBe("Municipal");
    expect(inferOwnership("King County Solid Waste")).toBe("Municipal");
  });

  it("classifies private owners", () => {
    expect(inferOwnership("GFL Environmental USA Inc.")).toBe("Private");
    expect(inferOwnership("WM")).toBe("Private");
  });
});

describe("mapLmopFeature", () => {
  it("maps valid EPA features to Landfill records", () => {
    const result = mapLmopFeature({
      attributes: {
        OBJECTID: 42,
        landfill_name: "Test Landfill",
        county_state: "Harris, TX",
        landfill_owner_org: "WM",
        current_landfill_status: "Open",
        latitude: 29.76,
        longitude: -95.37,
        landfill_design_cap: 10000,
        waste_in_place_tons: 5000,
      },
    });

    expect(result).toMatchObject({
      id: "42",
      name: "Test Landfill",
      state: "TX",
      county: "Harris",
      lat: 29.76,
      lng: -95.37,
      ownership: "Private",
      acceptsPV: "Unknown",
      operationalStatus: "Open",
      source: "EPA LMOP",
    });
  });

  it("returns null when coordinates are missing", () => {
    expect(
      mapLmopFeature({
        attributes: {
          OBJECTID: 1,
          landfill_name: "Bad",
          county_state: "X, Y",
          landfill_owner_org: null,
          current_landfill_status: null,
          latitude: null,
          longitude: -95,
          landfill_design_cap: null,
          waste_in_place_tons: null,
        },
      }),
    ).toBeNull();
  });
});
