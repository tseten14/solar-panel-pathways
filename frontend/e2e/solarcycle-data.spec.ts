import { test, expect } from "@playwright/test";
import { mockArcGISApis } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await mockArcGISApis(page);
});

test("the app opens on the SolarCycle Data page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/solarcycle$/);
  await expect(page.getByRole("link", { name: "SolarCycle Data" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "SolarCycle Data" })).toBeVisible();
  await expect(page.getByPlaceholder("Search name, city or operator…")).toBeVisible();
});
