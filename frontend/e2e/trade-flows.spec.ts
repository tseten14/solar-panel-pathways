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
