const { test, expect } = require("@playwright/test");
const { setup, expectNoCsp, trackErrors } = require("../helpers");

test.describe("landing + legal pages", () => {
  test("landing renders, links to sign-up and the legal pages, and violates no CSP", async ({ context, page }) => {
    await setup(context);
    const errors = trackErrors(page);
    await page.goto("/");
    await expect(page).toHaveTitle(/Land the engineering job/);
    await expect(page.getByRole("link", { name: /Get started free/ }).first()).toHaveAttribute("href", "auth.html?mode=signup");
    await expect(page.locator('footer a[href="privacy.html"]')).toBeVisible();
    await expect(page.locator('footer a[href="terms.html"]')).toBeVisible();
    await expectNoCsp(page);
    expect(errors).toEqual([]);
  });

  test("the theme toggle is shared across pages", async ({ context, page }) => {
    await setup(context);
    await page.goto("/");
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.locator("[data-theme-toggle]").first().click();
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(after).not.toBe(before);
    await page.goto("/auth.html");
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(after);
    await page.goto("/privacy.html");
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(after);
  });

  test("the privacy policy says what is actually read from Gmail and states the Limited Use commitment", async ({ context, page }) => {
    await setup(context, { config: { operatorName: "Nexus Labs", contactEmail: "hello@example.com" } });
    await page.goto("/privacy.html");
    const text = await page.locator("main").innerText();
    expect(text).toMatch(/gmail\.readonly/);
    expect(text).toMatch(/sender, subject, date and the short snippet/);
    expect(text).toMatch(/in memory only/);
    expect(text).toMatch(/Limited Use/);
    expect(text).toMatch(/Delete my account and data/);
    await expectNoCsp(page);
  });

  for (const pagePath of ["/privacy.html", "/terms.html"]) {
    test(`${pagePath} refuses to look finished while the operator and contact are unset`, async ({ context, page }) => {
      await setup(context);                                                    // empty operatorName / contactEmail
      await page.goto(pagePath);
      await expect(page.locator("#legalWarn")).toBeVisible();
      expect(await page.locator(".legal-missing").count()).toBeGreaterThan(0);
    });

    test(`${pagePath} fills in the operator and a mailto link when configured`, async ({ context, page }) => {
      await setup(context, { config: { operatorName: "Nexus Labs", contactEmail: "hello@example.com" } });
      await page.goto(pagePath);
      await expect(page.locator("#legalWarn")).toBeHidden();
      await expect(page.locator('a[href="mailto:hello@example.com"]').first()).toBeVisible();
      await expect(page.locator("[data-operator]").first()).toHaveText("Nexus Labs");
      expect(await page.locator(".legal-missing").count()).toBe(0);
    });
  }

  test("a malicious contactEmail cannot inject markup into the legal pages", async ({ context, page }) => {
    await setup(context, { config: { operatorName: "<img src=x onerror=window.__pwned=1>", contactEmail: '"><script>window.__pwned=1</script>@x.com' } });
    await page.goto("/privacy.html");
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    expect(await page.locator("main img").count()).toBe(0);
    await expect(page.locator("#legalWarn")).toBeVisible();                    // rejected as invalid -> still flagged
  });

  test("after account deletion the landing page confirms it and cleans the URL", async ({ context, page }) => {
    await setup(context);
    await page.goto("/?deleted=1");
    await expect(page.locator(".notice-bar")).toHaveText(/deleted/);
    expect(page.url()).not.toContain("deleted=1");
  });

  test("the sign-in page offers local mode when Firebase isn't configured, and links the policies", async ({ context, page }) => {
    await setup(context);
    await page.goto("/auth.html");
    await expect(page.locator("#setupNote")).toBeVisible();
    await expect(page.locator('.fine a[href="terms.html"]')).toBeVisible();
    await expect(page.locator('.fine a[href="privacy.html"]')).toBeVisible();
    await expectNoCsp(page);
  });
});
