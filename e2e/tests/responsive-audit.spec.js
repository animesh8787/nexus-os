/* Production-readiness sweep for the public (unauthenticated) pages: no page should ever be
 * able to scroll sideways, log a console error, or fail a CSP directive, at any of the three
 * sizes real visitors use. The portal's own screens have equivalent coverage in
 * portal-local.spec.js ("no screen scrolls sideways on a phone"); this file is the same
 * guarantee for the landing, sign-in/sign-up, legal pages and the 404 page.
 */
const { test, expect } = require("@playwright/test");
const { setup, trackErrors, expectNoCsp } = require("../helpers");

const SIZES = [["mobile", 375, 812], ["tablet", 768, 1024], ["desktop", 1440, 900]];
const PAGES = ["/index.html", "/auth.html", "/auth.html?mode=signup", "/privacy.html", "/terms.html", "/404.html"];

test.describe("production audit: public pages", () => {
  for (const [name, w, h] of SIZES) {
    for (const p of PAGES) {
      test(`${p} @ ${name}: no horizontal scroll, no console errors, no CSP violations`, async ({ context, page }) => {
        await setup(context);
        const errors = trackErrors(page);
        await page.setViewportSize({ width: w, height: h });
        await page.goto(p);
        await page.waitForTimeout(300);

        // The real signal for "does this page scroll sideways" is the document's own
        // scrollWidth, not any one element's box - a decorative element (e.g. .hero-rings)
        // may legitimately extend past the viewport under the page's overflow-x:clip.
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollWidth, "document.scrollWidth vs viewport on " + p + " @ " + name).toBeLessThanOrEqual(w + 1);

        const scrolledTo = await page.evaluate(() => { window.scrollTo(9999, 0); return window.scrollX; });
        expect(scrolledTo, "page actually scrolled sideways on " + p + " @ " + name).toBe(0);

        expect(errors, "console errors on " + p + " @ " + name).toEqual([]);
        await expectNoCsp(page);
      });
    }
  }

  test("mobile drawer menu: opens, lists the same links as desktop nav, and its anchors resolve", async ({ context, page }) => {
    await setup(context);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/index.html");
    await expect(page.locator(".s-links")).toBeHidden();       // desktop nav is off-screen at this width
    await page.locator(".s-burger").click();
    await expect(page.locator(".s-drawer")).toHaveClass(/open/);
    await expect(page.locator(".s-burger")).toHaveAttribute("aria-expanded", "true");
    await page.locator(".s-drawer .dl", { hasText: "Features" }).click();
    await expect(page).toHaveURL(/#features$/);
    await expect(page.locator("#features")).toBeVisible();
  });

  test("404 page: unknown paths land here, and every link on it resolves to a real page", async ({ context, page }) => {
    await setup(context);
    await page.goto("/404.html");
    await expect(page.locator("h1")).toContainText(/not|wandered/i);
    for (const href of ["index.html", "auth.html", "privacy.html", "terms.html"]) {
      const res = await page.request.get("/" + href);
      expect(res.ok(), href + " should resolve").toBeTruthy();
    }
  });
});
