import { expect, test, type Page } from "@playwright/test";

/** Fails the test on any console error or uncaught exception (hydration mismatches included). */
function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test("home page renders and links to the docs", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Type-safe WebMCP tools for TypeScript");
  await expect(page.getByText("Not published yet.")).toBeVisible();
  await expect(page.getByText("not affiliated with the unrelated")).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1); // one main landmark (HomeLayout renders it)
  await page.getByRole("link", { name: "Quick start" }).first().click();
  await expect(page).toHaveURL(/\/docs\/quick-start$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Quick start");
  expect(errors).toEqual([]);
});

test("docs pages hydrate and navigate on the client", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/docs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Introduction");
  await expect(page.getByRole("main")).toHaveCount(1);
  // A client-side navigation fetches the prerendered .data payload instead of reloading.
  const data = page.waitForResponse((r) => r.url().endsWith("/docs/react.data") && r.ok());
  await page.getByRole("link", { name: "React", exact: true }).first().click();
  await data;
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("React");
  await expect(page).toHaveTitle("React | webmcp-sdk");
  expect(errors).toEqual([]);
});

test("the generated API reference lists the exports", async ({ page }) => {
  await page.goto("/docs/api/core");
  await expect(page.locator("#definetool")).toBeVisible();
  await expect(page.locator("#createtoolcatalog")).toBeVisible();
  await page.goto("/docs/api/react");
  await expect(page.locator("#useregistertools")).toBeVisible();
});

test("search runs in the browser on the static index", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/docs");
  await page.getByRole("button", { name: /search/i }).first().click();
  await page.getByRole("dialog").getByRole("combobox", { name: "Search" }).fill("polyfill");
  await expect(page.getByRole("dialog").getByText(/Polyfills and custom model contexts/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("unknown URLs get the 404 page", async ({ page }) => {
  const errors = trackErrors(page);
  const response = await page.goto("/docs/does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
  expect(errors.filter((e) => !e.includes("404"))).toEqual([]); // the browser logs the 404 response itself
});
