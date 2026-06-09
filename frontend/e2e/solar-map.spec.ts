import { test, expect } from "@playwright/test";

test("solar map page loads inference controls", async ({ page }) => {
  await page.goto("/solar-map");
  await expect(page.getByText("Inference")).toBeVisible();
  await expect(page.getByRole("button", { name: "SAM 3" })).toBeVisible();
  await expect(page.getByRole("button", { name: "YOLO" })).toBeVisible();
});
