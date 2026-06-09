import { test, expect } from "@playwright/test";
import { mockArcGISApis } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await mockArcGISApis(page);
});

test("coverage analysis page loads", async ({ page }) => {
  await page.goto("/predictions");
  await expect(page.getByRole("heading", { name: "State Coverage Analysis" })).toBeVisible();
});
