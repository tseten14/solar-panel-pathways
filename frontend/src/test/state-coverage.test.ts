import { describe, it, expect } from "vitest";
import type { Landfill } from "@/types/landfill";
import type { SolarStateStats } from "@/types/solar";
import {
  haversineMiles,
  computeAcceptanceProbability,
  computeAvgCost,
  computeConfidenceInterval,
  isWasteDesert,
  computeStateCoverage,
} from "@/lib/state-coverage";

function makeLandfill(overrides: Partial<Landfill> & Pick<Landfill, "id" | "state" | "lat" | "lng">): Landfill {
  return {
    name: "Test Landfill",
    county: "Test",
    ownership: "Private",
    acceptsPV: "Unknown",
    tippingFee: null,
    tippingFeeUnit: "$/ton",
    minLoad: null,
    tclpRequired: false,
    notes: "",
    lastSurveyed: "",
    surveyorName: "",
    operationalStatus: "Open",
    ...overrides,
  };
}

describe("haversineMiles", () => {
  it("returns ~0 for identical coordinates", () => {
    expect(haversineMiles(34.05, -118.24, 34.05, -118.24)).toBeCloseTo(0, 1);
  });

  it("returns plausible distance between LA and SF", () => {
    const miles = haversineMiles(34.05, -118.24, 37.77, -122.42);
    expect(miles).toBeGreaterThan(300);
    expect(miles).toBeLessThan(400);
  });
});

describe("computeAcceptanceProbability", () => {
  it("scales with landfill density per 1000 MW", () => {
    expect(computeAcceptanceProbability(10, 1000)).toBe(100);
    expect(computeAcceptanceProbability(2, 1000)).toBe(30);
    expect(computeAcceptanceProbability(0, 500)).toBe(0);
  });

  it("handles zero solar MW with fallback scaling", () => {
    expect(computeAcceptanceProbability(5, 0)).toBe(100);
  });
});

describe("computeAvgCost", () => {
  it("blends municipal and private placeholder costs", () => {
    const landfills = [
      makeLandfill({ id: "1", state: "TX", lat: 30, lng: -97, ownership: "Municipal" }),
      makeLandfill({ id: "2", state: "TX", lat: 30.1, lng: -97.1, ownership: "Private" }),
    ];
    expect(computeAvgCost(landfills)).toBe(79);
  });

  it("uses tipping fees when available", () => {
    const landfills = [
      makeLandfill({ id: "1", state: "TX", lat: 30, lng: -97, tippingFee: 90 }),
      makeLandfill({ id: "2", state: "TX", lat: 30.1, lng: -97.1, tippingFee: 70 }),
    ];
    expect(computeAvgCost(landfills)).toBe(80);
  });
});

describe("isWasteDesert", () => {
  it("flags sparse landfill coverage", () => {
    expect(isWasteDesert(2, 50, 600)).toBe(true);
  });

  it("flags distant facilities with high solar capacity", () => {
    expect(isWasteDesert(5, 120, 600)).toBe(true);
  });

  it("does not flag adequate nearby coverage", () => {
    expect(isWasteDesert(5, 40, 600)).toBe(false);
    expect(isWasteDesert(5, 120, 400)).toBe(false);
  });
});

describe("computeConfidenceInterval", () => {
  it("widens interval when landfill count is low", () => {
    const low = computeConfidenceInterval(50, 1);
    const high = computeConfidenceInterval(50, 25);
    expect(low[1] - low[0]).toBeGreaterThan(high[1] - high[0]);
    expect(low[0]).toBeGreaterThanOrEqual(0);
    expect(low[1]).toBeLessThanOrEqual(100);
  });
});

describe("computeStateCoverage", () => {
  const solarStats: SolarStateStats[] = [
    { state: "CA", facilityCount: 100, totalCapacityMw: 10000 },
    { state: "KS", facilityCount: 5, totalCapacityMw: 600 },
  ];

  const landfills: Landfill[] = [
    makeLandfill({ id: "ca1", state: "CA", name: "CA Landfill A", lat: 34.0, lng: -118.0 }),
    makeLandfill({ id: "ca2", state: "CA", name: "CA Landfill B", lat: 34.5, lng: -118.5 }),
    makeLandfill({ id: "ca3", state: "CA", name: "CA Landfill C", lat: 35.0, lng: -119.0 }),
    makeLandfill({ id: "ca4", state: "CA", name: "CA Landfill D", lat: 35.5, lng: -119.5 }),
    makeLandfill({ id: "ks1", state: "KS", name: "KS Landfill", lat: 39.0, lng: -98.0 }),
    makeLandfill({
      id: "co1",
      state: "CO",
      name: "CO Remote Landfill",
      lat: 40.0,
      lng: -105.0,
    }),
  ];

  it("computes per-state metrics from landfills and solar stats", () => {
    const coverage = computeStateCoverage(landfills, solarStats);
    expect(coverage).toHaveLength(2);

    const ca = coverage.find((c) => c.state === "CA");
    expect(ca).toMatchObject({
      state: "CA",
      landfillCount: 4,
      solarMw: 10000,
      wasteDesert: false,
    });
    expect(ca!.acceptanceProbability).toBeGreaterThan(0);
    expect(ca!.nearestFacility).toBeTruthy();
    expect(ca!.nearestDistance).toBeLessThan(50);
  });

  it("marks waste deserts for sparse or distant high-solar states", () => {
    const coverage = computeStateCoverage(landfills, solarStats);
    const ks = coverage.find((c) => c.state === "KS");
    expect(ks).toBeDefined();
    expect(ks!.wasteDesert).toBe(true);
    expect(ks!.landfillCount).toBe(1);
  });
});
