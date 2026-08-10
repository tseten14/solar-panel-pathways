import { test, expect } from "@playwright/test";
import { mockArcGISApis } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await mockArcGISApis(page);
});

test("trade flows page loads modelled routes", async ({ page }) => {
  await page.goto("/trade-flows");
  await expect(page.getByText(/Modelled Interstate Flows/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/not observed trade data/i)).toBeVisible();
});

test("trade flows page shows its title", async ({ page }) => {
  // Both map pages used to render no page title at all, so nothing on screen
  // named where you were.
  await page.goto("/trade-flows");
  await expect(page.getByRole("heading", { name: "Trade Flows" })).toBeVisible({ timeout: 30_000 });
});
