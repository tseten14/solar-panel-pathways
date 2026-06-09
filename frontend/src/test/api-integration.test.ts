import { describe, it, expect } from "vitest";
import { fetchLandfills } from "@/lib/landfill-api";
import { fetchSolarStatsByState, fetchSolarFacilitiesByState } from "@/lib/solar-api";

const runLive = process.env.RUN_LIVE_API_TESTS === "1";

describe.skipIf(!runLive)("live API integration", () => {
  it(
    "fetches EPA LMOP landfills",
    async () => {
      const landfills = await fetchLandfills();
      expect(landfills.length).toBeGreaterThan(2000);
      expect(landfills[0]).toMatchObject({
        name: expect.any(String),
        lat: expect.any(Number),
        lng: expect.any(Number),
        source: "EPA LMOP",
      });
    },
    30_000,
  );

  it(
    "fetches USGS solar stats by state",
    async () => {
      const stats = await fetchSolarStatsByState();
      expect(stats.length).toBeGreaterThan(40);
      const ca = stats.find((s) => s.state === "CA");
      expect(ca?.facilityCount).toBeGreaterThan(100);
      expect(ca?.totalCapacityMw).toBeGreaterThan(1000);
    },
    15_000,
  );

  it(
    "fetches USGS solar facilities for a single state",
    async () => {
      const facilities = await fetchSolarFacilitiesByState("NV");
      expect(facilities.length).toBeGreaterThan(10);
      expect(facilities[0]).toMatchObject({
        state: "NV",
        capacityMw: expect.any(Number),
        lat: expect.any(Number),
        lng: expect.any(Number),
      });
    },
    30_000,
  );
});
