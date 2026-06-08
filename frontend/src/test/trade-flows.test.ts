import { describe, it, expect } from "vitest";
import { computeModelledTradeRoutes } from "@/lib/trade-flows";
import type { Landfill } from "@/types/landfill";
import type { SolarStateStats } from "@/types/solar";

function landfill(partial: Partial<Landfill> & Pick<Landfill, "id" | "state" | "lat" | "lng">): Landfill {
  return {
    name: partial.name ?? "Test LF",
    county: partial.county ?? "Test",
    ownership: partial.ownership ?? "Private",
    acceptsPV: partial.acceptsPV ?? "Unknown",
    tippingFee: partial.tippingFee ?? null,
    tippingFeeUnit: "$/ton",
    minLoad: null,
    tclpRequired: false,
    notes: "",
    lastSurveyed: "",
    surveyorName: "",
    operationalStatus: partial.operationalStatus ?? "Open",
    ...partial,
  };
}

describe("computeModelledTradeRoutes", () => {
  it("returns routes from waste-desert origins to better-covered destinations", () => {
    const landfills: Landfill[] = [
      // NJ — few open sites (waste desert candidate)
      landfill({ id: "1", state: "NJ", lat: 40.7, lng: -74.0, name: "NJ Site A" }),
      landfill({ id: "2", state: "NJ", lat: 40.8, lng: -74.1, name: "NJ Site B" }),
      // PA — many open sites
      ...Array.from({ length: 6 }, (_, i) =>
        landfill({
          id: `pa-${i}`,
          state: "PA",
          lat: 40.2 + i * 0.05,
          lng: -76.5 + i * 0.05,
          name: `PA Site ${i}`,
        }),
      ),
    ];

    const solarStats: SolarStateStats[] = [
      { state: "NJ", facilityCount: 50, totalCapacityMw: 1200 },
      { state: "PA", facilityCount: 40, totalCapacityMw: 800 },
    ];

    const routes = computeModelledTradeRoutes(landfills, solarStats);
    expect(routes.length).toBeGreaterThan(0);

    const njRoute = routes.find((r) => r.origin === "NJ");
    expect(njRoute).toBeDefined();
    expect(njRoute!.destState).toBe("PA");
    expect(njRoute!.isInternational).toBe(false);
    expect(njRoute!.estimatedVolumeTons).toBeGreaterThan(0);
    expect(njRoute!.distanceMiles).toBeGreaterThan(0);
  });

  it("returns empty when no viable destinations exist", () => {
    const landfills = [
      landfill({ id: "1", state: "KS", lat: 38.5, lng: -98.0 }),
      landfill({ id: "2", state: "KS", lat: 38.6, lng: -98.1 }),
    ];
    const solarStats = [{ state: "KS", facilityCount: 5, totalCapacityMw: 2000 }];
    expect(computeModelledTradeRoutes(landfills, solarStats)).toEqual([]);
  });

  it("never creates international routes", () => {
    const landfills: Landfill[] = [];
    for (const [state, lat, lng] of [
      ["CA", 36.7, -119.5],
      ["NV", 36.2, -115.1],
      ["TX", 31.0, -99.0],
      ["LA", 30.5, -91.2],
    ] as const) {
      for (let i = 0; i < 5; i++) {
        landfills.push(
          landfill({
            id: `${state}-${i}`,
            state,
            lat: lat + i * 0.1,
            lng: lng + i * 0.1,
            name: `${state} LF ${i}`,
          }),
        );
      }
    }

    const solarStats: SolarStateStats[] = [
      { state: "CA", facilityCount: 800, totalCapacityMw: 25000 },
      { state: "NV", facilityCount: 60, totalCapacityMw: 5000 },
      { state: "TX", facilityCount: 180, totalCapacityMw: 20000 },
      { state: "LA", facilityCount: 20, totalCapacityMw: 500 },
    ];

    const routes = computeModelledTradeRoutes(landfills, solarStats);
    expect(routes.every((r) => r.isInternational === false)).toBe(true);
    expect(routes.length).toBeLessThanOrEqual(15);
  });
});
