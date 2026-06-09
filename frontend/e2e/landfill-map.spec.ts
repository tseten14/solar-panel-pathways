import { test, expect } from "@playwright/test";
import { mockArcGISApis } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await mockArcGISApis(page);
});

test("landfill map page loads with filters visible", async ({ page }) => {
  await page.goto("/map");
  await expect(page.getByText("Filters")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("State", { exact: true })).toBeVisible();
  await expect(page.getByText("Ownership", { exact: true })).toBeVisible();
  await expect(page.getByText("PV Acceptance", { exact: true })).toBeVisible();
});
