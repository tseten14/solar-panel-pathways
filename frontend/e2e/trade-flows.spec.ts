import { test, expect } from "@playwright/test";

test("trade flows page loads modelled routes", async ({ page }) => {
  await page.goto("/trade-flows");

  await expect(
    page.getByText(/Modelled Interstate Flows|Computing modelled|EPA LMOP/i).first(),
  ).toBeVisible({ timeout: 90_000 });

  const disclaimer = page.getByText(/not observed trade data/i);
  const routeCard = page.getByText(/tons\/yr/i).first();

  await expect(disclaimer.or(routeCard)).toBeVisible({ timeout: 90_000 });
});
