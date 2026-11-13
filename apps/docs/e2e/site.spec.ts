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
  // A client-side navigation fetches the loader result prerendered as static JSON, instead of reloading.
  const data = page.waitForResponse((r) => r.url().includes("/__tsr/staticServerFnCache/") && r.ok());
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

for (const url of ["/docs/does-not-exist", "/does-not-exist"]) {
  test(`unknown URLs get the 404 page: ${url}`, async ({ page }) => {
    const errors = trackErrors(page);
    const response = await page.goto(url);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
    await expect(page).toHaveURL(url); // hydrated in place, no redirect
    expect(errors.filter((e) => !e.includes("404"))).toEqual([]); // the browser logs the 404 response itself
  });
}

for (const url of ["/", "/docs/react", "/does-not-exist"]) {
  test(`skip link to the content, visible on focus: ${url}`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(url);
    const skip = page.locator('a[href="#nd-page"]');
    await expect(skip).toHaveCount(1);
    await expect(skip).toHaveText("Skip to Content");
    // The target is inside the page's single <main>.
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("main").locator("#nd-page")).toHaveCount(1);
    // Visually hidden until focused.
    expect((await skip.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
    // Reachable from the keyboard, in the first few Tab stops.
    let focused = false;
    for (let i = 0; i < 5 && !focused; i++) {
      await page.keyboard.press("Tab");
      focused = await skip.evaluate((el) => el === document.activeElement);
    }
    expect(focused).toBe(true);
    expect((await skip.boundingBox())?.width ?? 0).toBeGreaterThan(20);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#nd-page$/);
    expect(errors.filter((e) => !e.includes("404"))).toEqual([]);
  });
}
