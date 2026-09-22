import { test, expect } from "@playwright/test";
import { mockArcGISApis } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await mockArcGISApis(page);
});

test("sidebar link opens the SolarCycle Data page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "SolarCycle Data" }).click();
  await expect(page).toHaveURL(/\/solarcycle$/);
  await expect(page.getByRole("heading", { name: "SolarCycle Data" })).toBeVisible();
  await expect(page.getByPlaceholder("Search name, city or operator…")).toBeVisible();
});
