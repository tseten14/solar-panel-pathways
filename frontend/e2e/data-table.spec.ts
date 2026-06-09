import { test, expect } from "@playwright/test";
import { mockArcGISApis } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await mockArcGISApis(page);
});

test("data table page loads with search", async ({ page }) => {
  await page.goto("/data");
  await expect(page.getByRole("heading", { name: "Data Table" })).toBeVisible();
  await expect(page.getByPlaceholder("Search facilities…")).toBeVisible();
});
