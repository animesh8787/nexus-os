const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { setup, enterLocalMode, expectNoCsp, trackErrors } = require("../helpers");

const SAMPLE_PDF = path.join(__dirname, "..", "..", "tests", "sample-resume.pdf");

test.describe("portal in local mode", () => {
  test("the gate sends visitors to sign-in, then every screen renders without errors", async ({ context, page }) => {
    await setup(context);
    const errors = trackErrors(page);
    await page.goto("/app.html");
    await expect(page).toHaveURL(/auth\.html\?next=app\.html/);
    await page.locator("#localBtn").click();
    await page.locator("#nav .nav-item").first().waitFor();
    const views = await page.$$eval("#nav .nav-item", (n) => n.map((x) => x.dataset.view));
    expect(views.length).toBeGreaterThanOrEqual(14);
    for (const v of views) {
      await page.evaluate((view) => window.NEXUS.go(view), v);
      await expect(page.locator("#content")).not.toBeEmpty();
    }
    expect(errors).toEqual([]);
    await expectNoCsp(page);
  });

  test("no screen scrolls sideways on a phone", async ({ context, page }) => {
    await setup(context);
    await page.setViewportSize({ width: 375, height: 812 });
    await enterLocalMode(page);
    const views = await page.$$eval("#nav .nav-item", (n) => n.map((x) => x.dataset.view));
    const bad = [];
    for (const v of views) {
      await page.evaluate((view) => window.NEXUS.go(view), v);
      await page.waitForTimeout(150);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 2) bad.push(v + " +" + over);
    }
    expect(bad).toEqual([]);
  });

  test("toasts are plain text: third-party names can't inject HTML", async ({ context, page }) => {
    await setup(context);
    await enterLocalMode(page);
    await page.evaluate(() => window.NEXUS.toast('Saved <img src=x onerror="window.__pwned=1"> to your tracker'));
    await expect(page.locator("#toasts .toast")).toContainText("<img src=x");     // shown literally
    expect(await page.locator("#toasts img").count()).toBe(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });

  test("hostile job titles from a feed can't inject markup into cards or the tracker", async ({ context, page }) => {
    await setup(context);
    await enterLocalMode(page);
    await page.evaluate(() => {
      const evil = '<img src=x onerror="window.__pwned=1">';
      window.NEXUS.S.jobfeed.cache = [{ id: "gh:e-1", title: evil, company: evil, loc: evil, url: "https://example.com/j", score: 9, isNew: true, srcLabel: evil, posted: Date.now(), hits: [evil] }];
      window.NEXUS.S.jobs = [{ id: "e1", co: evil, role: evil, dt: "2026-09-01", pipeline: "applied", events: [{ d: "2026-09-01", t: "applied", src: "manual", note: evil }], notes: evil }];
      window.NEXUS.go("jobfeed");
    });
    await expect(page.locator(".job-card")).toBeVisible();
    await page.evaluate(() => window.NEXUS.go("jobs"));
    await page.locator(".tcard").click();
    await expect(page.locator(".modal")).toBeVisible();
    expect(await page.locator("#content img").count()).toBe(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });

  test("resume upload: a real PDF is parsed in the browser with pdf.js (integrity-checked, CSP on) into a draft, then applied", async ({ context, page }) => {
    await setup(context, { realCdn: true });                                   // real sri.js, real cdnjs
    const errors = trackErrors(page);
    await enterLocalMode(page);
    await page.evaluate(() => window.NEXUS.go("profile"));
    await page.locator("#pfFile").setInputFiles(SAMPLE_PDF);
    const draft = page.locator(".draft-card");
    await expect(draft).toBeVisible({ timeout: 30_000 });
    await expect(draft).toContainText("pytorch");
    await expect(draft).toContainText("machine learning");
    await draft.getByRole("button", { name: /Apply to my profile/ }).click();
    await expect(page.locator(".draft-card")).toHaveCount(0);
    const filters = await page.evaluate(() => window.NEXUS.S.jobfeed.filters);
    expect(filters.include).toContain("pytorch");
    expect(filters.levels).toContain("internship");
    await page.evaluate(() => window.NEXUS.go("jobfeed"));
    await expect(page.locator(".match-banner")).toContainText("Ranked for");
    expect(errors).toEqual([]);
    await expectNoCsp(page);                                                    // includes pdf.js's worker + eval probing
  });

  test("a tampered pdf.js from the CDN is refused by the integrity check", async ({ context, page }) => {
    await setup(context, { realCdn: true });
    await context.route(/pdf\.min\.js$/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "window.pdfjsLib = { tampered: true };" }));
    await enterLocalMode(page);
    await page.evaluate(() => window.NEXUS.go("profile"));
    await page.locator("#pfFile").setInputFiles(SAMPLE_PDF);
    await expect(page.locator("#content .auth-err")).toContainText(/helper library/);
    expect(await page.evaluate(() => window.pdfjsLib && window.pdfjsLib.tampered)).toBeFalsy();
  });

  test("every AI Coach button sends an action prompts.js actually knows - regression for 'job' vs 'job_advice'", async ({ context, page }) => {
    await setup(context);
    const calls = [];
    await context.route(/api\.groq\.com\/openai\/v1\/chat\/completions/, (r) => {
      calls.push(r.request().postDataJSON());
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: "Looks good." } }] }) });
    });
    await enterLocalMode(page);
    await page.evaluate(() => { window.NEXUS.S.settings.groqKey = "gsk_test"; window.NEXUS.S.settings.groqModel = "llama-3.3-70b-versatile"; window.NEXUS.save(); });
    await page.evaluate(() => window.NEXUS.go("coach"));
    for (const label of ["Daily briefing", "What to solve next", "Weekly retro", "Job search advice"]) {
      await page.getByRole("button", { name: label }).click();
      await expect(page.locator("#content")).not.toContainText("Unknown AI action", { timeout: 8000 });
      await expect(page.locator("#content")).toContainText("Looks good.");
    }
    expect(calls.length).toBe(4);   // every click reached Groq - none was rejected client-side before the request
  });
});

/* ---------------- tracker ---------------- */
const GMAIL = {
  s1: { from: '"Stripe" <no-reply@us.greenhouse-mail.io>', subject: "Thank you for applying to Stripe", snippet: "We received your application", d: "2026-09-10" },
  s2: { from: "Stripe <recruiting@stripe.com>", subject: "Online Assessment Invitation - Stripe", snippet: "", d: "2026-09-14" },
  s3: { from: "Stripe <recruiting@stripe.com>", subject: "Interview invitation - Stripe", snippet: "", d: "2026-09-19" },
  r1: { from: "Razorpay Careers <careers@razorpay.com>", subject: "Update on your application for Backend Engineer", snippet: "Unfortunately, we will not be moving forward with your application.", d: "2026-09-20" },
  j1: { from: "LinkedIn Job Alerts <jobs-listings@linkedin.com>", subject: "5 new jobs for software engineer", snippet: "", d: "2026-09-20" },
};
const FAKE_GIS = `window.google={accounts:{oauth2:{initTokenClient:function(cfg){window.__gis=cfg;return{requestAccessToken:function(o){window.__req=o;setTimeout(function(){cfg.callback({access_token:'e2e-token-123',expires_in:3600})},20)}}},revoke:function(t,cb){window.__revoked=t;cb&&cb()}}}};`;

test.describe("job tracker", () => {
  test("Gmail sync turns emails into dated applications, ignores noise, and never stores the token", async ({ context, page }) => {
    await setup(context, { config: { googleClientId: "e2e.apps.googleusercontent.com" } });
    const requests = [];
    await context.route(/accounts\.google\.com\/gsi\/client/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: FAKE_GIS }));
    await context.route(/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages/, (r) => {
      const url = r.request().url();
      requests.push({ url: decodeURIComponent(url), auth: r.request().headers()["authorization"] });
      if (/\/messages\?/.test(url)) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ messages: Object.keys(GMAIL).reverse().map((id) => ({ id })) }) });
      const id = url.match(/messages\/([a-z0-9]+)\?/)[1], m = GMAIL[id];
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id, snippet: m.snippet, internalDate: String(new Date(m.d + "T10:00:00").getTime()),
        payload: { headers: [{ name: "From", value: m.from }, { name: "Subject", value: m.subject }, { name: "Date", value: m.d }] } }) });
    });
    await enterLocalMode(page);
    await page.evaluate(() => window.NEXUS.go("jobs"));
    await page.getByRole("button", { name: /Connect Gmail/ }).click();
    await expect(page.locator(".col-interview .tcard")).toContainText("Stripe");
    await expect(page.locator(".col-closed .tcard")).toContainText("Razorpay");
    await expect(page.locator(".tcard")).toHaveCount(2);                        // the LinkedIn alert made no card
    expect(await page.evaluate(() => window.__gis.scope)).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(requests[0].auth).toBe("Bearer e2e-token-123");
    const stored = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage) + JSON.stringify(window.NEXUS.S));
    expect(stored).not.toContain("e2e-token-123");
    // the timeline carries the real dates
    await page.locator(".col-interview .tcard").click();
    const tl = await page.locator(".tl-item").allInnerTexts();
    expect(tl.join("|")).toMatch(/Assessment[\s\S]*Sep 14/);
    expect(tl.join("|")).toMatch(/Interview[\s\S]*Sep 19/);
    await expectNoCsp(page);
  });

  test("Inbox review: fix a wrong stage, remove a non-job email for good, and a rescan doesn't bring it back", async ({ context, page }) => {
    await setup(context, { config: { googleClientId: "e2e.apps.googleusercontent.com" } });
    await context.route(/accounts\.google\.com\/gsi\/client/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: FAKE_GIS }));
    await context.route(/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages/, (r) => {
      const url = r.request().url();
      if (/\/messages\?/.test(url)) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ messages: Object.keys(GMAIL).reverse().map((id) => ({ id })) }) });
      const id = url.match(/messages\/([a-z0-9]+)\?/)[1], m = GMAIL[id];
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id, snippet: m.snippet, internalDate: String(new Date(m.d + "T10:00:00").getTime()),
        payload: { headers: [{ name: "From", value: m.from }, { name: "Subject", value: m.subject }, { name: "Date", value: m.d }] } }) });
    });
    await enterLocalMode(page);
    await page.evaluate(() => window.NEXUS.go("jobs"));
    await page.getByRole("button", { name: /Connect Gmail/ }).click();
    await expect(page.locator(".tcard")).toHaveCount(2);

    const card = page.locator("#inboxReview");
    await expect(card).toContainText("4 emails");
    await card.getByRole("button", { name: "Review" }).click();
    await expect(card.locator(".rv-row")).toHaveCount(4);

    // Razorpay was filed as a rejection; say it was only a confirmation
    const razor = card.locator(".rv-row", { hasText: "Razorpay" });
    await razor.locator("select").first().selectOption("received");
    await expect(page.locator(".col-closed .tcard")).toHaveCount(0);
    await expect(page.locator(".col-applied .tcard")).toContainText("Razorpay");

    // the Stripe assessment mail is not a job email: remove it, the application drops back to the interview it still has
    await card.locator(".rv-row", { hasText: "Online Assessment Invitation" }).getByRole("button", { name: "Not a job email" }).click();
    await expect(card.locator(".rv-row")).toHaveCount(3);
    await expect(page.locator(".col-interview .tcard")).toContainText("Stripe");

    // rescanning the inbox must not re-add the removed mail
    await page.getByRole("button", { name: "Rescan 90 days" }).click();
    await expect(page.locator("#inboxReview .rv-row")).toHaveCount(3);
    expect(await page.evaluate(() => Object.keys(window.NEXUS.S.gmail.ignored).length)).toBe(1);

    // mark everything checked
    await page.locator("#inboxReview").getByRole("button", { name: "Mark all as checked" }).click();
    await expect(page.locator("#inboxReview")).toContainText("has been checked");
    await expectNoCsp(page);
  });

  test("AI check for unclear emails: nothing is sent until the user opts in, then only name+domain, subject and snippet", async ({ context, page }) => {
    await setup(context, { config: { googleClientId: "e2e.apps.googleusercontent.com" } });
    const G2 = { ...GMAIL, u1: { from: "Initech Talent <priya.k@initech.io>", subject: "Regarding your candidacy", snippet: "Congratulations on reaching the final stage.", d: "2026-09-18" } };
    const groq = [];
    await context.route(/accounts\.google\.com\/gsi\/client/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: FAKE_GIS }));
    await context.route(/api\.groq\.com\/openai\/v1\/chat\/completions/, (r) => {
      groq.push(r.request().postDataJSON());
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ results: [{ i: 0, type: "interview", company: "Initech", role: "Backend Engineer" }] }) } }] }) });
    });
    await context.route(/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages/, (r) => {
      const url = r.request().url();
      if (/\/messages\?/.test(url)) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ messages: Object.keys(G2).reverse().map((id) => ({ id })) }) });
      const id = url.match(/messages\/([a-z0-9]+)\?/)[1], m = G2[id];
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id, snippet: m.snippet, internalDate: String(new Date(m.d + "T10:00:00").getTime()),
        payload: { headers: [{ name: "From", value: m.from }, { name: "Subject", value: m.subject }, { name: "Date", value: m.d }] } }) });
    });
    await enterLocalMode(page);
    await page.evaluate(() => { window.NEXUS.S.settings.groqKey = "gsk_test"; window.NEXUS.S.settings.groqModel = "llama-3.3-70b-versatile"; window.NEXUS.save(); });
    await page.evaluate(() => window.NEXUS.go("jobs"));
    await page.getByRole("button", { name: /Connect Gmail/ }).click();
    await expect(page.locator(".tcard")).toHaveCount(2);
    expect(groq.length, "no AI request before the user opts in").toBe(0);
    await expect(page.locator(".ai-row")).toContainText("Off");

    // cancelling the dialog changes nothing
    await page.getByRole("button", { name: "Turn on…" }).click();
    const dlg = page.locator(".dlg");
    await expect(dlg).toContainText("the sender's name and domain (not the email address)");
    await expect(dlg).toContainText("What is never sent");
    await dlg.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(".ai-row")).toContainText("Off");

    // opt in
    await page.getByRole("button", { name: "Turn on…" }).click();
    await page.locator(".dlg").getByRole("button", { name: "Yes, send unclear emails" }).click();
    await expect(page.locator(".ai-row")).toContainText("On");
    await page.getByRole("button", { name: "Rescan 90 days" }).click();
    await expect(page.locator(".col-interview .tcard", { hasText: "Initech" })).toHaveCount(1);
    expect(groq.length).toBe(1);
    const sent = JSON.stringify(groq[0].messages);
    expect(sent).toContain("Regarding your candidacy");
    expect(sent).toContain("initech.io");
    expect(sent).not.toContain("priya.k@");              // the address never leaves the browser
    expect(sent).not.toContain("Thank you for applying to Stripe");   // mail the rules handled is never sent
    expect(groq[0].response_format).toEqual({ type: "json_object" });

    // the AI's filing is flagged for the user to confirm
    await page.locator("#inboxReview").getByRole("button", { name: "Review" }).click();
    await expect(page.locator("#inboxReview .rv-row").filter({ has: page.locator(".rv-title", { hasText: "Initech" }) })).toContainText("AI-suggested");

    // opt out again
    await page.getByRole("button", { name: "Turn off" }).click();
    await expect(page.locator(".ai-row")).toContainText("Off");
    expect(await page.evaluate(() => window.NEXUS.S.gmail.ai.on)).toBe(false);
    await expectNoCsp(page);
  });

  test("Apply -> come back -> 'I applied' puts the job on the board with today's date", async ({ context, page }) => {
    await setup(context);
    await enterLocalMode(page);
    await page.evaluate(() => {
      window.NEXUS.S.jobfeed.cache = [{ id: "gh:acme-1", title: "Backend Engineer", company: "Acme", url: "https://example.com/apply", loc: "Remote", score: 9, isNew: true, srcLabel: "Acme", posted: Date.now(), hits: ["python"] }];
      window.NEXUS.go("jobfeed");
    });
    const [popup] = await Promise.all([page.waitForEvent("popup"), page.locator("a.btn-primary", { hasText: "Apply" }).click()]);
    await popup.close();
    await page.evaluate(() => { window.NEXUS.S.pendingApply.forEach((p) => (p.ts -= 20000)); window.dispatchEvent(new Event("focus")); });
    const prompt = page.locator("#applyPrompt.show");
    await expect(prompt).toContainText("Did you apply?");
    await expect(prompt).toContainText("Backend Engineer");
    await prompt.getByRole("button", { name: "I applied" }).click();
    await expect(page.locator("#applyPrompt.show")).toHaveCount(0);
    await page.evaluate(() => window.NEXUS.go("jobs"));
    await expect(page.locator(".col-applied .tcard")).toContainText("Acme");
    const row = await page.evaluate(() => window.NEXUS.S.jobs[0]);
    expect(row.pipeline).toBe("applied");
    expect(row.dt).toBe(await page.evaluate(() => window.NEXUS.iso()));
    expect(row.jobId).toBe("gh:acme-1");
  });

  test("declining removes the prompt and adds nothing", async ({ context, page }) => {
    await setup(context);
    await enterLocalMode(page);
    await page.evaluate(() => {
      window.NEXUS.S.pendingApply = [{ id: "x1", title: "SRE", company: "Foo", url: "https://example.com", loc: "", sal: "", src: "", ts: Date.now() - 20000, snooze: 0 }];
      window.dispatchEvent(new Event("focus"));
    });
    await page.locator("#applyPrompt.show").getByRole("button", { name: "No" }).click();
    await expect(page.locator("#applyPrompt.show")).toHaveCount(0);
    expect(await page.evaluate(() => window.NEXUS.S.jobs.length)).toBe(0);
  });

  test("the application drawer is keyboard-accessible: open, focus trapped, Escape closes and returns focus", async ({ context, page }) => {
    await setup(context);
    await enterLocalMode(page);
    await page.evaluate(() => {
      window.NEXUS.S.jobs = [{ id: "j1", co: "Stripe", role: "Backend Engineer", dt: "2026-09-10", pipeline: "applied", events: [{ d: "2026-09-10", t: "applied", src: "manual" }] }];
      window.NEXUS.go("jobs");
    });
    const card = page.locator(".tcard");
    await card.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".modal")).toBeVisible();
    expect(await page.evaluate(() => !!document.activeElement.closest(".modal"))).toBe(true);
    for (let i = 0; i < 30; i++) {                                              // Tab through more stops than the dialog has
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement.closest(".modal")), "Tab #" + i + " escaped the dialog").toBe(true);
    }
    for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => !!document.activeElement.closest(".modal"))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator(".modal")).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains("tcard"))).toBe(true);
  });

  test("using a control inside the drawer doesn't drop keyboard focus when the view re-renders", async ({ context, page }) => {
    await setup(context);
    await enterLocalMode(page);
    await page.evaluate(() => {
      window.NEXUS.S.jobs = [{ id: "j1", co: "Stripe", role: "Backend Engineer", dt: "2026-09-10", pipeline: "applied", events: [{ d: "2026-09-10", t: "applied", src: "manual" }] }];
      window.NEXUS.go("jobs");
    });
    await page.locator(".tcard").click();
    const offer = page.locator('.modal [data-action="trk-stage"][data-s="interview"]');
    await offer.focus();
    await page.keyboard.press("Enter");                                          // re-renders the whole drawer
    expect(await page.evaluate(() => window.NEXUS.S.jobs[0].pipeline)).toBe("interview");
    expect(await page.evaluate(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.s)).toBe("interview");
  });

  test("dragging a card to another column moves the application", async ({ context, page }) => {
    await setup(context);
    await enterLocalMode(page);
    await page.evaluate(() => {
      window.NEXUS.S.jobs = [{ id: "j1", co: "Stripe", role: "Backend Engineer", dt: "2026-09-10", pipeline: "applied", events: [{ d: "2026-09-10", t: "applied", src: "manual" }] }];
      window.NEXUS.go("jobs");
    });
    /* Synthesised HTML5 drag events can be dropped when the machine is busy, so drag the way a pointer
       does (small steps) and retry the gesture a bounded number of times. A real bug still fails. */
    await expect(async () => {
      const src = await page.locator(".col-applied .tcard").boundingBox();
      if (src) {
        const dst = await page.locator(".col-interview .col-body").boundingBox();
        await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
        await page.mouse.down();
        await page.mouse.move(dst.x + dst.width / 2, dst.y + 20, { steps: 15 });
        await page.mouse.up();
      }
      await expect(page.locator(".col-interview .tcard")).toContainText("Stripe", { timeout: 2500 });
    }).toPass({ timeout: 20_000 });
    expect(await page.evaluate(() => window.NEXUS.S.jobs[0].pipeline)).toBe("interview");
  });
});
