import type { Page } from "@playwright/test";

const MOCK_LMOP = {
  features: [
    {
      attributes: {
        OBJECTID: 1,
        landfill_name: "Mock Landfill",
        county_state: "Washtenaw, MI",
        landfill_owner_org: "Test County",
        current_landfill_status: "Open",
        latitude: 42.28,
        longitude: -83.74,
        landfill_design_cap: 1000,
        waste_in_place_tons: 500,
      },
    },
  ],
};

const MOCK_SOLAR_STATS = {
  features: [
    {
      attributes: {
        p_state: "MI",
        total_mw: 120.5,
        facility_count: 12,
      },
    },
    {
      attributes: {
        p_state: "CA",
        total_mw: 5000,
        facility_count: 400,
      },
    },
  ],
};

export async function mockArcGISApis(page: Page) {
  await page.route("**/New_Landfills/FeatureServer/0/query**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_LMOP),
    });
  });

  await page.route("**/uspvdbDyn/FeatureServer/0/query**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_SOLAR_STATS),
    });
  });
}
