import { test, expect } from "@playwright/test";

test("solar map page loads scan tools and review queue", async ({ page }) => {
  await page.goto("/solar-map");
  await expect(page.getByRole("button", { name: "Single" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Multi" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Erase" })).toBeVisible();
  await expect(page.getByText("Review Queue")).toBeVisible();
});
