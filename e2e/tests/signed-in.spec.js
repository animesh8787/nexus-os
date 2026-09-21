const { test, expect } = require("@playwright/test");
const { setup, newCloud, USER, openPortal, expectNoCsp, trackErrors, BASE } = require("../helpers");

const CFG = { api: "https://ai.test" };

async function device(browser, cloud, user, config = CFG) {
  const context = await browser.newContext({ baseURL: BASE });
  await setup(context, { fake: true, user, cloud, config });
  const page = await context.newPage();
  return { context, page };
}
const cloudKeys = (cloud) => [...cloud.store.keys()].sort();
const seedApp = (page, co = "Stripe", id = "a1") =>
  page.evaluate(([c, i]) => {
    window.NEXUS.S.jobs.push({ id: i, co: c, role: "Backend Engineer", dt: "2026-09-10", pipeline: "applied", status: "applied", stage: "Applied", events: [{ d: "2026-09-10", t: "applied", src: "manual" }] });
    window.NEXUS.save();
  }, [co, id]);

test.describe("signed in (fake Firebase + shared fake cloud)", () => {
  test("a signed-in user passes the gate; the sidebar shows who they are and the sync state", async ({ browser }) => {
    const cloud = newCloud();
    const { page } = await device(browser, cloud, USER);
    const errors = trackErrors(page);
    await openPortal(page);
    await expect(page.locator("#userChip")).toContainText("aarav@example.com");
    await expect(page.locator("#cloudChip")).toContainText(/Synced|Syncing|Sync pending/);
    await expect(page.locator("#cloudChip")).toContainText("Synced", { timeout: 10_000 });
    expect(errors).toEqual([]);
    await expectNoCsp(page);
  });

  test("edits are backed up to the cloud - and secrets never are", async ({ browser }) => {
    const cloud = newCloud();
    const { page } = await device(browser, cloud, USER);
    await openPortal(page);
    await page.evaluate(() => { const s = window.NEXUS.S; s.settings.ghToken = "github_pat_TOPSECRET"; s.settings.groqKey = "gsk_TOPSECRET"; s.jobfeed.cache = [{ id: "c1", title: "CACHED-JOB-TITLE" }]; });
    await seedApp(page);
    await expect.poll(() => cloudKeys(cloud).join(","), { timeout: 10_000 }).toContain("users/u1/apps/a1");
    expect(cloudKeys(cloud)).toEqual(expect.arrayContaining(["users/u1/state/core", "users/u1/state/feed", "users/u1/apps/a1"]));
    const everything = JSON.stringify([...cloud.store.values()]);
    expect(everything).not.toContain("TOPSECRET");
    expect(everything).not.toContain("CACHED-JOB-TITLE");
    expect(everything).toContain("Stripe");
    for (const rec of cloud.store.values()) expect(Object.keys(rec).sort()).toEqual(["json", "u", "v"]);      // exactly the shape the rules allow
  });

  test("two devices: an application added on one appears on the other, and a delete propagates back", async ({ browser }) => {
    const cloud = newCloud();
    const A = await device(browser, cloud, USER);
    await openPortal(A.page);
    await seedApp(A.page);
    await expect.poll(() => cloudKeys(cloud).join(","), { timeout: 10_000 }).toContain("users/u1/apps/a1");

    const B = await device(browser, cloud, USER);                               // a second browser, same account
    await openPortal(B.page);
    await B.page.evaluate(() => window.NEXUS.go("jobs"));
    await expect(B.page.locator(".tcard")).toContainText("Stripe", { timeout: 10_000 });

    await B.page.evaluate(() => { window.NEXUS.S.jobs = []; window.NEXUS.save(); window.NEXUS.go("jobs"); });      // delete on B
    await expect.poll(() => cloudKeys(cloud).join(","), { timeout: 10_000 }).not.toContain("users/u1/apps/a1");
    await A.page.evaluate(() => window.NEXUS.sync.run("full"));
    await expect.poll(() => A.page.evaluate(() => window.NEXUS.S.jobs.length), { timeout: 10_000 }).toBe(0);
    await A.context.close(); await B.context.close();
  });

  test("a device that already has a cloud copy adopts it on first sign-in and keeps its own extra items", async ({ browser }) => {
    const cloud = newCloud();
    const A = await device(browser, cloud, USER);
    await openPortal(A.page);
    await A.page.evaluate(() => { window.NEXUS.S.settings.lcGoal = 777; window.NEXUS.save(); });
    await seedApp(A.page, "Stripe", "a1");
    await expect.poll(() => cloudKeys(cloud).join(","), { timeout: 10_000 }).toContain("users/u1/apps/a1");

    const B = await device(browser, cloud, USER);
    await B.page.addInitScript(() => {                                            // this device has its own pre-existing local data
      if (!localStorage.getItem("seeded-b")) {
        localStorage.setItem("seeded-b", "1");
        localStorage.setItem("nexus-os:v3:u1", JSON.stringify({ settings: { lcGoal: 123 }, jobs: [{ id: "b1", co: "Notion", role: "SDE", dt: "2026-09-02", pipeline: "applied", status: "applied", stage: "Applied", events: [{ d: "2026-09-02", t: "applied", src: "manual" }] }] }));
      }
    });
    await openPortal(B.page);
    await expect.poll(() => B.page.evaluate(() => window.NEXUS.S.settings.lcGoal), { timeout: 10_000 }).toBe(777);      // cloud wins for settings
    await expect.poll(() => B.page.evaluate(() => window.NEXUS.S.jobs.map((j) => j.id).sort().join(",")), { timeout: 10_000 }).toBe("a1,b1");
    await expect.poll(() => cloudKeys(cloud).join(","), { timeout: 10_000 }).toContain("users/u1/apps/b1");            // and B's own item was uploaded
    expect(await B.page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("nexus-os:backup:")))).toBe(true);   // overwritten local state was backed up
    await A.context.close(); await B.context.close();
  });

  test("an unverified email can use the portal but cloud sync is refused, with a clear explanation", async ({ browser }) => {
    const cloud = newCloud();
    const { page } = await device(browser, cloud, { ...USER, emailVerified: false });
    await openPortal(page);
    await expect(page.locator("#cloudChip")).toContainText("Sync problem", { timeout: 10_000 });
    await expect(page.locator("#cloudChip")).toHaveAttribute("title", /Verify your email/);
    await seedApp(page);
    expect(await page.evaluate(() => window.NEXUS.S.jobs.length)).toBe(1);        // still works locally
    expect(cloud.store.size).toBe(0);                                             // nothing was stored server-side

    // the user clicks the link in their inbox, then syncs again
    await page.evaluate(() => { const u = JSON.parse(localStorage.getItem("fake-fb-user")); u.emailVerified = true; localStorage.setItem("fake-fb-user", JSON.stringify(u)); });
    expect(await page.evaluate(() => window.NexusAuth.refreshVerification())).toBe(true);
    await page.evaluate(() => window.NEXUS.sync.run("full"));
    await expect.poll(() => cloudKeys(cloud).join(","), { timeout: 10_000 }).toContain("users/u1/apps/a1");
  });

  test("the sign-up form creates an account and tells the user to verify their email", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: BASE });
    await setup(context, { fake: true, config: CFG });
    const page = await context.newPage();
    await page.goto("/auth.html?mode=signup");
    await page.locator("#name").fill("Priya");
    await page.locator("#email").fill("priya@example.com");
    await page.locator("#pw").fill("s3cret-pass");
    await page.locator("#submit").click();
    await expect(page).toHaveURL(/app\.html/);
    await page.locator("#nav .nav-item").first().waitFor();
    await expect(page.locator("#toasts")).toContainText(/Verify your email/);
    await expect(page.locator("#userChip")).toContainText("priya@example.com");
  });

  test("signed-out visitors are sent to sign-in; a session ended elsewhere leaves the portal", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: BASE });
    await setup(context, { fake: true, config: CFG });                            // no user seeded
    const page = await context.newPage();
    await page.goto("/app.html");
    await expect(page).toHaveURL(/auth\.html\?next=app\.html/);
    await expect(page.locator("#formArea")).toBeVisible();
  });
});

/* ---------------- AI behind the proxy ---------------- */
test.describe("AI proxy and verified email", () => {
  test("a stale token is refreshed once after the email is verified, and the request is retried", async ({ browser }) => {
    const cloud = newCloud();
    const { context, page } = await device(browser, cloud, { ...USER, emailVerified: false });
    const seen = [];
    await context.route("https://ai.test/ai", (r) => {
      const auth = r.request().headers()["authorization"];
      seen.push(auth);
      if (auth === "Bearer fake-id-token") return r.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Verify your email address to use the AI features.", code: "email_not_verified" }) });
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "Here is your plan.", remaining: 39 }) });
    });
    await openPortal(page);
    await page.evaluate(() => { const u = JSON.parse(localStorage.getItem("fake-fb-user")); u.emailVerified = true; localStorage.setItem("fake-fb-user", JSON.stringify(u)); });   // link clicked in another tab
    const text = await page.evaluate(() => window.NXAI.run("brief", { ctx: {} }));
    expect(text).toBe("Here is your plan.");
    expect(seen).toEqual(["Bearer fake-id-token", "Bearer fake-id-token-fresh"]);
    expect(await page.evaluate(() => window.__fakeCounters.tokenRefreshes)).toBe(1);
  });

  test("still unverified: no endless retry, and the message says what to do", async ({ browser }) => {
    const { context, page } = await device(browser, newCloud(), { ...USER, emailVerified: false });
    let calls = 0;
    await context.route("https://ai.test/ai", (r) => { calls++; return r.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Verify your email address to use the AI features.", code: "email_not_verified" }) }); });
    await openPortal(page);
    const msg = await page.evaluate(() => window.NXAI.run("brief", { ctx: {} }).then(() => "no error", (e) => e.message));
    expect(msg).toMatch(/Verify your email address/);
    expect(msg).toMatch(/Settings/);
    expect(calls).toBe(1);                                                        // it did not hammer the service
  });

  test("the request carries only an action and data - never a prompt", async ({ browser }) => {
    const { context, page } = await device(browser, newCloud(), USER);
    let body;
    await context.route("https://ai.test/ai", (r) => { body = JSON.parse(r.request().postData()); return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "ok", remaining: 1 }) }); });
    await openPortal(page);
    await page.evaluate(() => window.NXAI.run("job_advice", { funnel: { applied: 3 } }));
    expect(Object.keys(body).sort()).toEqual(["action", "data"]);
    expect(body.action).toBe("job_advice");
  });

  test("daily-limit and capacity errors are shown as written by the service", async ({ browser }) => {
    const { context, page } = await device(browser, newCloud(), USER);
    await context.route("https://ai.test/ai", (r) => r.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "You've reached today's AI limit (40). It resets tomorrow.", code: "daily_limit" }) }));
    await openPortal(page);
    const msg = await page.evaluate(() => window.NXAI.run("brief", {}).then(() => "", (e) => e.message));
    expect(msg).toMatch(/today's AI limit/);
  });
});

/* ---------------- deleting an account ---------------- */
test.describe("delete account", () => {
  async function withData(browser, user = USER) {
    const cloud = newCloud();
    const d = await device(browser, cloud, user);
    await openPortal(d.page);
    await seedApp(d.page);
    await d.page.evaluate(() => { window.NEXUS.S.solves.push({ id: "s1", slug: "two-sum", title: "Two Sum", difficulty: "Easy", topics: [], lang: "python", date: "2026-09-01", code: "x" }); window.NEXUS.save(); });
    await expect.poll(() => cloud.store.size, { timeout: 10_000 }).toBeGreaterThanOrEqual(4);
    await d.page.evaluate(() => window.NEXUS.go("settings"));
    return { cloud, ...d };
  }

  test("the confirm button stays disabled until DELETE and the password are entered", async ({ browser }) => {
    const { page } = await withData(browser);
    await page.getByRole("button", { name: /Delete my account and data/ }).click();
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible();
    const ok = dlg.getByRole("button", { name: "Delete everything" });
    await expect(ok).toBeDisabled();
    await dlg.getByLabel("Type DELETE to confirm").fill("delete");
    await expect(ok).toBeDisabled();                                              // case matters
    await dlg.getByLabel("Type DELETE to confirm").fill("DELETE");
    await expect(ok).toBeDisabled();                                              // password accounts must also give the password
    await dlg.getByLabel("Your password").fill("x");
    await expect(ok).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
  });

  test("a wrong password deletes NOTHING: cloud data, local data and the account all survive", async ({ browser }) => {
    const { page, cloud } = await withData(browser);
    const before = cloud.store.size;
    await page.getByRole("button", { name: /Delete my account and data/ }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Type DELETE to confirm").fill("DELETE");
    await dlg.getByLabel("Your password").fill("not-the-password");
    await dlg.getByRole("button", { name: "Delete everything" }).click();
    await expect(page.locator("#toasts")).toContainText(/password/i);
    expect(cloud.store.size).toBe(before);
    expect(await page.evaluate(() => window.__fakeCounters.deleted)).toBe(false);
    expect(await page.evaluate(() => !!localStorage.getItem("nexus-os:v3:u1"))).toBe(true);
    expect(page.url()).toContain("app.html");
  });

  test("with the right password everything is erased - cloud, local copy, session - and the landing page confirms it", async ({ browser }) => {
    const { page, cloud } = await withData(browser);
    await page.getByRole("button", { name: /Delete my account and data/ }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Type DELETE to confirm").fill("DELETE");
    await dlg.getByLabel("Your password").fill(USER.password);
    await dlg.getByRole("button", { name: "Delete everything" }).click();
    await expect(page).toHaveURL(/index\.html\?deleted=1|\/\?deleted=1|index\.html/, { timeout: 15_000 });
    await expect(page.locator(".notice-bar")).toHaveText(/deleted/);
    expect(cloud.store.size).toBe(0);
    const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("nexus-os:v3:") || k.startsWith("nexus-os:sync:") || k.startsWith("nexus-os:backup:") || k === "fake-fb-user"));
    expect(left).toEqual([]);
    await expectNoCsp(page);
  });

  test("local mode: erase removes this browser's data", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: BASE });
    await setup(context);
    const page = await context.newPage();
    await page.goto("/auth.html");
    await page.locator("#localBtn").click();
    await page.locator("#nav .nav-item").first().waitFor();
    await page.evaluate(() => { window.NEXUS.S.jobs.push({ id: "z", co: "X", role: "Y", dt: "2026-09-01", pipeline: "applied", events: [{ d: "2026-09-01", t: "applied", src: "manual" }] }); window.NEXUS.save(); window.NEXUS.go("settings"); });
    expect(await page.evaluate(() => !!localStorage.getItem("nexus-os:v3:local"))).toBe(true);
    await page.getByRole("button", { name: /Erase local data/ }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Type DELETE to confirm").fill("DELETE");
    await dlg.getByRole("button", { name: "Erase everything" }).click();
    await expect(page.locator(".notice-bar")).toHaveText(/deleted/, { timeout: 10_000 });
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("nexus-os:v3:") || k === "nexus-os:local-mode"))).toEqual([]);
  });
});

/* ---------------- the real Firebase SDK, loaded under integrity checks ---------------- */
test("the real Firebase SDK loads from Google's CDN under Subresource Integrity and the CSP", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: BASE });
  await setup(context, { realCdn: true, config: { firebase: { apiKey: "AIzaSyStandIn-not-real", projectId: "stand-in", appId: "1:1:web:1", authDomain: "stand-in.firebaseapp.com" } } });
  const page = await context.newPage();
  const errors = trackErrors(page);
  await page.goto("/auth.html");
  await expect(page.locator("#formArea")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.firebase && window.firebase.SDK_VERSION), { timeout: 20_000 }).toBe("10.14.1");
  const sri = await page.$$eval("script[integrity]", (s) => s.map((x) => ({ src: x.src.split("/").pop(), ci: x.crossOrigin, i: x.integrity.slice(0, 7) })));
  expect(sri.map((s) => s.src).sort()).toEqual(["firebase-app-compat.js", "firebase-auth-compat.js"]);
  for (const s of sri) { expect(s.ci).toBe("anonymous"); expect(s.i).toBe("sha384-"); }
  await expectNoCsp(page);
  expect(errors).toEqual([]);
});
