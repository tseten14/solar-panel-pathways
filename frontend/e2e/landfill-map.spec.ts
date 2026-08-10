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
  // The filter is "Status" (EPA operational status). It was renamed from
  // "PV Acceptance" when the fabricated PV-policy field was removed, and this
  // assertion was never updated.
  await expect(page.getByText("Status", { exact: true })).toBeVisible();
});

test("landfill map page shows its title", async ({ page }) => {
  // Both map pages used to render no page title at all, so nothing on screen
  // named where you were.
  await page.goto("/map");
  await expect(page.getByRole("heading", { name: "Landfill Map" })).toBeVisible({ timeout: 30_000 });
});
