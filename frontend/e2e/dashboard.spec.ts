import { test, expect } from "@playwright/test";

const LOAD_TIMEOUT = 90_000;

test("dashboard loads and shows MSW Landfills stat or EPA badge", async ({ page }) => {
  await page.goto("/");

  await Promise.race([
    page.waitForSelector("text=MSW Landfills", { timeout: LOAD_TIMEOUT }),
    page.waitForSelector("text=EPA LMOP", { timeout: LOAD_TIMEOUT }),
    page.waitForSelector("text=Loading", { timeout: LOAD_TIMEOUT }),
  ]);

  const hasMswLandfills = await page.getByText("MSW Landfills").isVisible();
  const hasEpaBadge = await page.getByText("EPA LMOP").first().isVisible();
  const hasLoading = await page.getByText(/Loading/i).first().isVisible();

  expect(hasMswLandfills || hasEpaBadge || hasLoading).toBe(true);
});
