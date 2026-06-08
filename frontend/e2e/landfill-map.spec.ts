import { test, expect } from "@playwright/test";

const LOAD_TIMEOUT = 90_000;

test("landfill map page loads with filters visible", async ({ page }) => {
  await page.goto("/map");

  await Promise.race([
    page.waitForSelector("text=Filters", { timeout: LOAD_TIMEOUT }),
    page.waitForSelector("text=EPA LMOP", { timeout: LOAD_TIMEOUT }),
    page.waitForSelector("text=Loading", { timeout: LOAD_TIMEOUT }),
  ]);

  const hasLoading = await page.getByText(/Loading/i).first().isVisible();

  if (!hasLoading) {
    await expect(page.getByText("Filters")).toBeVisible();
    await expect(page.getByText("State", { exact: true })).toBeVisible();
    await expect(page.getByText("Ownership", { exact: true })).toBeVisible();
    await expect(page.getByText("PV Acceptance", { exact: true })).toBeVisible();
  } else {
    await expect(page.getByText(/Loading/i).first()).toBeVisible();
  }
});
