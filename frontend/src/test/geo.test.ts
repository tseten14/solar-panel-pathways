import { describe, it, expect } from "vitest";
import { haversineDistanceMiles, findNearestLandfill } from "@/lib/geo";
import type { Landfill } from "@/types/landfill";

describe("haversineDistanceMiles", () => {
  it("returns 0 for identical coordinates", () => {
    expect(haversineDistanceMiles(40.7128, -74.006, 40.7128, -74.006)).toBe(0);
  });

  it("computes a known short distance within tolerance", () => {
    // NYC to Philadelphia ~80–83 miles
    const miles = haversineDistanceMiles(40.7128, -74.006, 39.9526, -75.1652);
    expect(miles).toBeGreaterThan(78);
    expect(miles).toBeLessThan(85);
  });

  it("computes a known long distance within tolerance", () => {
    // NYC to Los Angeles ~2445–2460 miles
    const miles = haversineDistanceMiles(40.7128, -74.006, 34.0522, -118.2437);
    expect(miles).toBeGreaterThan(2440);
    expect(miles).toBeLessThan(2470);
  });
});

describe("findNearestLandfill", () => {
  const base: Omit<Landfill, "id" | "name" | "lat" | "lng" | "operationalStatus"> = {
    state: "TX",
    county: "Harris",
    ownership: "Private",
    acceptsPV: "Unknown",
    tippingFee: null,
    tippingFeeUnit: "$/ton",
    minLoad: null,
    tclpRequired: false,
    notes: "",
    lastSurveyed: "",
    surveyorName: "",
  };

  const landfills: Landfill[] = [
    {
      ...base,
      id: "1",
      name: "Far Site",
      lat: 30.0,
      lng: -97.0,
      operationalStatus: "Open",
    },
    {
      ...base,
      id: "2",
      name: "Near Site",
      lat: 29.76,
      lng: -95.37,
      operationalStatus: "Open",
    },
    {
      ...base,
      id: "3",
      name: "Closed Site",
      lat: 29.75,
      lng: -95.36,
      operationalStatus: "Closed",
    },
  ];

  it("returns the nearest open landfill", () => {
    const result = findNearestLandfill(29.77, -95.38, landfills);
    expect(result?.landfill.name).toBe("Near Site");
    expect(result?.distanceMiles).toBeGreaterThan(0);
    expect(result?.distanceMiles).toBeLessThan(20);
  });

  it("ignores closed landfills", () => {
    const onlyClosed: Landfill[] = [
      { ...landfills[2] },
    ];
    expect(findNearestLandfill(29.75, -95.36, onlyClosed)).toBeNull();
  });

  it("returns null for invalid coordinates", () => {
    expect(findNearestLandfill(Number.NaN, -95.36, landfills)).toBeNull();
  });
});
