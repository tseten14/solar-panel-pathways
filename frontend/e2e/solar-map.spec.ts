import { test, expect } from "@playwright/test";

test("solar map page loads scan tools and review queue", async ({ page }) => {
  await page.goto("/solar-map");
  await expect(page.getByRole("button", { name: "Single" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Multi" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Erase" })).toBeVisible();
  await expect(page.getByText("Review Queue")).toBeVisible();
});

test("AI agent panel is open by default and can be hidden and reopened", async ({ page }) => {
  await page.goto("/solar-map");

  const panel = page.getByRole("complementary", { name: "AI map assistant" });
  await expect(panel).toBeVisible();
  await expect(panel.getByPlaceholder("Ask me to scan, review, or navigate…")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Scan what I'm looking at" })).toBeVisible();

  await panel.getByTitle("Hide the agent panel").click();
  await expect(panel).toBeHidden();

  await page.getByRole("button", { name: "AI Agent" }).click();
  await expect(panel).toBeVisible();
});

test("the review queue can be toggled from the header", async ({ page }) => {
  await page.goto("/solar-map");
  const queue = page.getByText("Review Queue");
  await expect(queue).toBeVisible();

  await page.getByRole("button", { name: /^Queue/ }).click();
  await expect(queue).toBeHidden();

  await page.getByRole("button", { name: /^Queue/ }).click();
  await expect(queue).toBeVisible();
});

test("the agent panel starts collapsed on a laptop-width screen", async ({ page }) => {
  // Below 1280px there is no room for map + queue + agent at once, so the agent
  // yields rather than squeezing the map.
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto("/solar-map");

  const panel = page.getByRole("complementary", { name: "AI map assistant" });
  await expect(panel).toBeHidden();
  await expect(page.getByText("Review Queue")).toBeVisible();

  await page.getByRole("button", { name: "AI Agent" }).click();
  await expect(panel).toBeVisible();
});

test("clicking a suggested prompt sends it as a message", async ({ page }) => {
  await page.goto("/solar-map");
  const panel = page.getByRole("complementary", { name: "AI map assistant" });

  await panel.getByRole("button", { name: "How many arrays are pending review?" }).click();

  // The user's turn is echoed immediately, before any backend reply.
  await expect(panel.getByRole("log")).toContainText("How many arrays are pending review?");
});
