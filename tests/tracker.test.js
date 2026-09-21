/* node --test tests/tracker.test.js  - email classification, matching and funnel maths */
const test = require("node:test");
const assert = require("node:assert");
globalThis.window = globalThis;
require("../tracker.js");
const T = globalThis.NXTracker;

const D = (s) => new Date(s + "T10:00:00").getTime();
const mail = (id, from, subject, snippet, date) => ({ id, from, subject, snippet: snippet || "", date: D(date) });
let n = 0; const newId = () => "id" + ++n;

/* ---------------- classification ---------------- */
test("confirmation from Greenhouse names the company from the sender", () => {
  const c = T.classifyEmail(mail("1", '"Stripe" <no-reply@us.greenhouse-mail.io>', "Thank you for applying to Stripe", "", "2026-09-10"));
  assert.strictEqual(c.type, "received");
  assert.strictEqual(c.company, "Stripe");
  assert.strictEqual(c.d, "2026-09-10");
});

test("'application to X' in the subject beats a generic display name", () => {
  const c = T.classifyEmail(mail("2", "Greenhouse <no-reply@greenhouse.io>", "Your application to Databricks", "", "2026-09-11"));
  assert.strictEqual(c.company, "Databricks");
  assert.strictEqual(c.type, "received");
});

test("Ashby 'X via Ashby' display name resolves to X", () => {
  const c = T.classifyEmail(mail("3", "Notion via Ashby <no-reply@ashbyhq.com>", "Thanks for applying!", "We received your application.", "2026-09-12"));
  assert.strictEqual(c.company, "Notion");
  assert.strictEqual(c.type, "received");
});

test("rejection is detected from the snippet, role from the subject", () => {
  const c = T.classifyEmail(mail("4", "Razorpay Careers <careers@razorpay.com>", "Update on your application for Software Engineer Intern",
    "Unfortunately, we will not be moving forward with your application at this time.", "2026-09-20"));
  assert.strictEqual(c.type, "rejected");
  assert.strictEqual(c.company, "Razorpay");
  assert.strictEqual(c.role, "Software Engineer Intern");
});

test("online assessment invitations", () => {
  const c = T.classifyEmail(mail("5", "Jane Street <recruiting@janestreet.com>", "Jane Street Online Assessment Invitation", "", "2026-09-14"));
  assert.strictEqual(c.type, "assessment");
  assert.strictEqual(c.company, "Jane Street");
  const h = T.classifyEmail(mail("6", "HackerRank Tests <no-reply@hackerrank.com>", "Coding challenge from Acme Robotics", "", "2026-09-15"));
  assert.strictEqual(h.type, "assessment");
  assert.strictEqual(h.company, "Acme Robotics");
});

test("interview invitation with role and company", () => {
  const c = T.classifyEmail(mail("7", "Anthropic <no-reply@us.greenhouse-mail.io>", "Interview invitation: Research Engineer at Anthropic", "", "2026-09-18"));
  assert.strictEqual(c.type, "interview");
  assert.strictEqual(c.company, "Anthropic");
  assert.strictEqual(c.role, "Research Engineer");
});

test("offer emails", () => {
  const c = T.classifyEmail(mail("8", "Acme Labs <hr@acmelabs.io>", "Offer letter - Software Engineer", "We are pleased to offer you the position.", "2026-09-25"));
  assert.strictEqual(c.type, "offer");
  assert.strictEqual(c.company, "Acme Labs");
});

test("a rejection that also says 'thank you for applying' is a rejection, not a confirmation", () => {
  const c = T.classifyEmail(mail("9", "Lumen AI <jobs@lumen.ai>", "Your application to Lumen AI",
    "Thank you for applying. Unfortunately we have decided to pursue other candidates.", "2026-09-22"));
  assert.strictEqual(c.type, "rejected");
});

test("Workday confirmation with a company display name", () => {
  const c = T.classifyEmail(mail("10", "Acme Corp <acme@myworkday.com>", "Thank you for applying", "", "2026-09-09"));
  assert.strictEqual(c.type, "received");
  assert.strictEqual(c.company, "Acme");     // legal suffix stripped
});

test("non-job mail is ignored", () => {
  const junk = [
    mail("a", "LinkedIn Job Alerts <jobs-listings@linkedin.com>", "5 new jobs for software engineer", "", "2026-09-10"),
    mail("b", "Google <no-reply@accounts.google.com>", "Security alert", "New sign-in on Windows", "2026-09-10"),
    mail("c", "Newsletter <news@somesite.com>", "Weekly digest: top 10 jobs this week", "", "2026-09-10"),
    mail("d", "Friend <friend@gmail.com>", "Lunch tomorrow?", "want to grab lunch", "2026-09-10"),
    mail("e", "Shop <orders@shop.com>", "Your order has been received", "thanks for your order", "2026-09-10"),
  ];
  junk.forEach((m) => assert.strictEqual(T.classifyEmail(m), null, m.subject));
});

test("never throws on empty or odd headers", () => {
  assert.doesNotThrow(() => T.classifyEmail({}));
  assert.strictEqual(T.classifyEmail({ from: "", subject: "", snippet: "" }), null);
  assert.doesNotThrow(() => T.classifyEmail({ from: "<>", subject: "application received", snippet: null, date: NaN }));
});

/* ---------------- matching + lifecycle ---------------- */
function run(mails, jobs = []) {
  const classified = mails.map((m) => T.classifyEmail(m)).filter(Boolean);
  const res = T.ingestEmails(jobs, classified, newId);
  return { jobs, res };
}

test("an application walks the pipeline with a dated event per email", () => {
  const { jobs, res } = run([
    mail("m1", '"Stripe" <no-reply@us.greenhouse-mail.io>', "Thank you for applying to Stripe", "", "2026-09-10"),
    mail("m2", "Stripe <recruiting@stripe.com>", "Online Assessment Invitation - Stripe", "", "2026-09-14"),
    mail("m3", "Stripe <recruiting@stripe.com>", "Interview invitation - Stripe", "", "2026-09-19"),
  ]);
  assert.strictEqual(jobs.length, 1);
  const j = jobs[0];
  assert.strictEqual(j.co, "Stripe");
  assert.strictEqual(j.pipeline, "interview");
  assert.strictEqual(j.status, "response");
  assert.strictEqual(j.dt, "2026-09-10", "applied date comes from the confirmation");
  assert.deepStrictEqual(j.events.map((e) => [e.t, e.d]), [["applied", "2026-09-10"], ["received", "2026-09-10"], ["assessment", "2026-09-14"], ["interview", "2026-09-19"]]);
  assert.strictEqual(res.added, 1);
});

test("emails are applied oldest-first even when the API returns newest-first", () => {
  const { jobs } = run([
    mail("z3", "Stripe <recruiting@stripe.com>", "Interview invitation - Stripe", "", "2026-09-19"),
    mail("z1", '"Stripe" <no-reply@us.greenhouse-mail.io>', "Thank you for applying to Stripe", "", "2026-09-10"),
    mail("z2", "Stripe <recruiting@stripe.com>", "Online Assessment Invitation - Stripe", "", "2026-09-14"),
  ]);
  assert.strictEqual(jobs[0].pipeline, "interview");
  assert.strictEqual(jobs[0].dt, "2026-09-10");
});

test("a rejection closes the row, and a duplicate confirmation cannot reopen it", () => {
  const { jobs } = run([
    mail("r1", '"Lumen AI" <no-reply@greenhouse.io>', "Thank you for applying to Lumen AI", "", "2026-09-01"),
    mail("r2", "Lumen AI <jobs@lumen.ai>", "Update on your application", "Unfortunately we are not moving forward.", "2026-09-10"),
    mail("r3", '"Lumen AI" <no-reply@greenhouse.io>', "Thank you for applying to Lumen AI", "", "2026-09-02"),   // duplicate confirmation, same application
  ]);
  const lumen = jobs.filter((j) => j.co === "Lumen AI");
  assert.strictEqual(lumen.length, 1, "the duplicate confirmation attaches to the same application");
  assert.strictEqual(lumen[0].pipeline, "rejected");
  assert.strictEqual(lumen[0].status, "rejected");
});

test("a confirmation weeks later is a NEW application and leaves the rejected one alone", () => {
  const { jobs } = run([
    mail("q1", '"Lumen AI" <no-reply@greenhouse.io>', "Thank you for applying to Lumen AI", "", "2026-09-01"),
    mail("q2", "Lumen AI <jobs@lumen.ai>", "Update on your application", "Unfortunately we are not moving forward.", "2026-09-10"),
    mail("q3", '"Lumen AI" <no-reply@greenhouse.io>', "Thank you for applying to Lumen AI", "", "2026-09-25"),
  ]);
  const lumen = jobs.filter((j) => j.co === "Lumen AI");
  assert.strictEqual(lumen.length, 2);
  assert.strictEqual(lumen.find((j) => j.dt === "2026-09-01").pipeline, "rejected");
  assert.strictEqual(lumen.find((j) => j.dt === "2026-09-25").pipeline, "applied");
});

test("re-processing the same emails is idempotent (no duplicate rows or events)", () => {
  const mails = [
    mail("i1", '"Stripe" <no-reply@us.greenhouse-mail.io>', "Thank you for applying to Stripe", "", "2026-09-10"),
    mail("i2", "Stripe <recruiting@stripe.com>", "Interview invitation - Stripe", "", "2026-09-19"),
  ];
  const jobs = [];
  run(mails, jobs);
  const events = jobs[0].events.length;
  const again = run(mails, jobs);
  assert.strictEqual(jobs.length, 1);
  assert.strictEqual(jobs[0].events.length, events);
  assert.strictEqual(again.res.events, 0);
});

test("a confirmation matches a row the user saved or added by hand", () => {
  const jobs = [T.normalizeJob({ id: "x", co: "Databricks", role: "Software Engineer Intern", dt: "2026-09-05", stage: "Found", status: "applied", url: "u" }, "2026-09-05")];
  assert.strictEqual(jobs[0].pipeline, "saved");
  run([mail("s1", "Databricks <no-reply@greenhouse.io>", "Thank you for applying to Databricks", "", "2026-09-08")], jobs);
  assert.strictEqual(jobs.length, 1, "no duplicate row");
  assert.strictEqual(jobs[0].pipeline, "applied");
  assert.strictEqual(jobs[0].dt, "2026-09-08", "saved -> applied stamps the real date");
});

test("same company, different role becomes a separate application", () => {
  const jobs = [T.normalizeJob({ id: "y", co: "Stripe", role: "Backend Engineer", dt: "2026-09-01", status: "applied", stage: "Applied" }, "2026-09-01")];
  run([mail("d1", "Stripe <no-reply@greenhouse.io>", "Your application for Machine Learning Intern at Stripe", "", "2026-09-12")], jobs);
  assert.strictEqual(jobs.filter((j) => j.co === "Stripe").length, 2);
});

test("a rejection with no prior row still creates a closed application", () => {
  const { jobs } = run([mail("n1", "Razorpay Careers <careers@razorpay.com>", "Update on your application for Backend Engineer", "Unfortunately we will not be moving forward.", "2026-09-20")]);
  assert.strictEqual(jobs.length, 1);
  assert.strictEqual(jobs[0].pipeline, "rejected");
  assert.ok(jobs[0].auto);
  assert.match(jobs[0].events[0].note, /Applied date unknown/);
});

test("company matching tolerates legal suffixes and case", () => {
  assert.ok(T.sameCompany("Stripe, Inc.", "stripe"));
  assert.ok(T.sameCompany("Razorpay Software Private Limited", "Razorpay"));
  assert.ok(!T.sameCompany("Meta", "Metabase"), "short names must not match by substring");
  assert.ok(!T.sameCompany("", "Stripe"));
});

/* ---------------- normalisation + funnel ---------------- */
test("legacy rows map onto the pipeline", () => {
  const f = (o) => T.normalizeJob(Object.assign({ id: "1", co: "A", role: "B", dt: "2026-09-01" }, o), "2026-09-01").pipeline;
  assert.strictEqual(f({ status: "applied", stage: "Applied" }), "applied");
  assert.strictEqual(f({ status: "applied", stage: "Found" }), "saved");
  assert.strictEqual(f({ status: "rejected", stage: "Rejected" }), "rejected");
  assert.strictEqual(f({ status: "response", stage: "OA pending" }), "assessment");
  assert.strictEqual(f({ status: "response", stage: "Technical interview" }), "interview");
  assert.strictEqual(f({ status: "response", stage: "Offer received" }), "offer");
});

test("funnel: response rate, median days to reply, stale and per-source numbers", () => {
  const mk = (id, dt, pipeline, events, source) => T.normalizeJob({ id, co: id, role: "r", dt, pipeline, events, source, status: "applied", stage: "x" }, dt);
  const jobs = [
    mk("a", "2026-08-01", "interview", [{ d: "2026-08-01", t: "applied" }, { d: "2026-08-05", t: "interview" }], "Greenhouse"),
    mk("b", "2026-08-01", "rejected", [{ d: "2026-08-01", t: "applied" }, { d: "2026-08-11", t: "rejected" }], "Greenhouse"),
    mk("c", "2026-08-01", "applied", [{ d: "2026-08-01", t: "applied" }], "Ashby"),
    mk("d", "2026-09-18", "applied", [{ d: "2026-09-18", t: "applied" }], "Ashby"),
    mk("e", "2026-09-01", "saved", [{ d: "2026-09-01", t: "saved" }], "Ashby"),
  ];
  const f = T.funnel(jobs, "2026-09-21");
  assert.strictEqual(f.applied, 4);
  assert.strictEqual(f.saved, 1);
  assert.strictEqual(f.stages.interview, 1);
  assert.strictEqual(f.stages.rejected, 1);
  assert.strictEqual(f.stages.applied, 2);
  assert.strictEqual(f.responseRate, 50, "2 of 4 replied");
  assert.strictEqual(f.medianDaysToReply, 10, "replies took 4 and 10 days -> upper median 10");
  assert.strictEqual(f.waiting, 2);
  assert.strictEqual(f.stale21d, 1, "only 'c' has waited 21+ days");
  assert.deepStrictEqual(f.bySource.Greenhouse, { applied: 2, replied: 2 });
});

test("funnel on an empty tracker does not divide by zero", () => {
  const f = T.funnel([], "2026-09-21");
  assert.strictEqual(f.applied, 0);
  assert.strictEqual(f.responseRate, 0);
  assert.strictEqual(f.medianDaysToReply, null);
});

/* ---------------- inbox review: correcting what the classifier did ---------------- */
function inboxJobs() {
  const jobs = [];
  const emails = [
    mail("m1", '"Acme" <no-reply@greenhouse.io>', "Thank you for applying to Acme", "", "2026-09-01"),
    mail("m2", '"Acme" <recruiting@acme.com>', "Interview invitation - Backend Engineer", "", "2026-09-05"),
    mail("m3", '"Acme" <recruiting@acme.com>', "Update on your application", "Unfortunately we will not be moving forward", "2026-09-09")
  ];
  T.ingestEmails(jobs, emails.map(T.classifyEmail).filter(Boolean), newId);
  return jobs;
}

test("review: mailEvents lists every email-derived entry, newest first", () => {
  const jobs = inboxJobs();
  const list = T.mailEvents(jobs);
  assert.deepStrictEqual(list.map((x) => x.ev.id), ["m3", "m2", "m1"]);
  assert.strictEqual(T.unreviewed(jobs), 3);
});

test("review: correcting a wrong 'rejected' puts the application back where it belongs", () => {
  const jobs = inboxJobs();
  assert.strictEqual(jobs[0].pipeline, "rejected");
  const x = T.mailEvents(jobs)[0];                       // m3, the rejection
  assert.ok(T.setMailType(x.job, x.i, "received"));
  assert.strictEqual(jobs[0].pipeline, "interview");     // the interview invite is still there
  assert.strictEqual(x.ev.ok, true);
});

test("review: a manual stage change survives the replay", () => {
  const jobs = inboxJobs();
  T.setPipeline(jobs[0], "offer", { date: "2026-09-20", src: "manual" });
  const x = T.mailEvents(jobs).find((y) => y.ev.id === "m3");
  T.setMailType(x.job, x.i, "received");
  assert.strictEqual(jobs[0].pipeline, "offer");
});

test("review: removing the only email of an auto-created application removes the application", () => {
  const jobs = [];
  T.ingestEmails(jobs, [T.classifyEmail(mail("z1", '"Globex" <no-reply@lever.co>', "Thanks for applying to Globex", "", "2026-09-02"))], newId);
  assert.strictEqual(jobs.length, 1);
  const x = T.mailEvents(jobs)[0];
  const r = T.dropMail(jobs, x.job, x.i);
  assert.deepStrictEqual(r, { id: "z1", removedJob: true });
  assert.strictEqual(jobs.length, 0);
});

test("review: removing one of several emails keeps the application and recomputes its stage", () => {
  const jobs = inboxJobs();
  const x = T.mailEvents(jobs).find((y) => y.ev.id === "m3");
  const r = T.dropMail(jobs, x.job, x.i);
  assert.strictEqual(r.removedJob, false);
  assert.strictEqual(jobs[0].pipeline, "interview");
  assert.strictEqual(T.mailEvents(jobs).length, 2);
});

test("review: a manually added application is never deleted when its last email is removed", () => {
  const j = T.normalizeJob({ id: "man", co: "Initech", role: "SWE", dt: "2026-09-01", source: "Manual", pipeline: "applied", events: [] }, "2026-09-01");
  j.events = [{ d: "2026-09-01", t: "applied", src: "manual" }, { d: "2026-09-04", t: "received", src: "gmail", id: "q1", subj: "x" }];
  const jobs = [j];
  T.dropMail(jobs, j, 1);
  assert.strictEqual(jobs.length, 1);
  assert.strictEqual(j.pipeline, "applied");
});

test("review: moving an email to another application updates both", () => {
  const jobs = inboxJobs();
  const other = T.normalizeJob({ id: "o", co: "Hooli", role: "SWE", dt: "2026-09-03", source: "Manual", pipeline: "applied", events: [] }, "2026-09-03");
  jobs.push(other);
  const x = T.mailEvents(jobs).find((y) => y.ev.id === "m2");
  const r = T.moveMail(jobs, x.job, x.i, other);
  assert.strictEqual(r.removedJob, false);
  assert.strictEqual(other.pipeline, "interview");
  assert.strictEqual(jobs[0].pipeline, "rejected");
});

test("review: only the five email types are accepted", () => {
  const jobs = inboxJobs();
  const x = T.mailEvents(jobs)[0];
  assert.strictEqual(T.setMailType(x.job, x.i, "hired"), false);
  assert.strictEqual(T.setMailType(x.job, x.i, "applied"), false);
});

/* ---------------- optional AI pass (opt-in) ---------------- */
test("ai: only genuinely unclear job-ish mail is a candidate - noise and already-classified mail are not", () => {
  const unclear = mail("a1", "Acme Talent <talent@acme.com>", "Regarding your candidacy", "Hi, quick update on where things stand.", "2026-09-10");
  assert.strictEqual(T.needsAI(unclear), true);
  assert.strictEqual(T.needsAI(mail("a2", "Deals <hi@shop.com>", "Big sale this weekend", "", "2026-09-10")), false);
  assert.strictEqual(T.needsAI(mail("a3", "LinkedIn Job Alerts <jobs-listings@linkedin.com>", "5 new jobs for you", "", "2026-09-10")), false);
  assert.strictEqual(T.needsAI(mail("a4", '"Stripe" <no-reply@greenhouse.io>', "Thank you for applying to Stripe", "", "2026-09-10")), false);
});

test("ai: the payload carries sender NAME and DOMAIN only - never the address - plus subject and snippet", () => {
  const p = T.aiPayload([mail("a1", '"Priya S" <priya.sharma@acme.com>', "Regarding your candidacy", "x".repeat(900), "2026-09-10")]);
  const s = JSON.stringify(p);
  assert.ok(!s.includes("priya.sharma"));
  assert.match(p.emails[0].from, /Priya S.*acme\.com/);
  assert.ok(p.emails[0].snippet.length <= 240);
  assert.deepStrictEqual(Object.keys(p.emails[0]).sort(), ["from", "snippet", "subject"]);
});

test("ai: results are validated - bad types, platforms, unknown indexes and duplicates are dropped", () => {
  const msgs = [mail("b0", "A (a.com)", "s0", "", "2026-09-10"), mail("b1", "B (b.com)", "s1", "", "2026-09-11"), mail("b2", "C (c.com)", "s2", "", "2026-09-12"), mail("b3", "D (d.com)", "s3", "", "2026-09-13")];
  const out = T.fromAI([
    { i: 0, type: "interview", company: "Acme", role: "Backend Engineer" },
    { i: 0, type: "offer", company: "Acme", role: "" },
    { i: 1, type: "hired", company: "Beta" },
    { i: 2, type: "rejected", company: "LinkedIn" },
    { i: 9, type: "received", company: "Nowhere" },
    { i: 3, type: "none", company: "" },
    null, "junk"
  ], msgs);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual({ t: out[0].type, c: out[0].company, r: out[0].role, id: out[0].id, ai: out[0].ai, d: out[0].d }, { t: "interview", c: "Acme", r: "Backend Engineer", id: "b0", ai: true, d: "2026-09-10" });
  assert.deepStrictEqual(T.fromAI("nope", msgs), []);
});

test("ai: an AI-classified mail becomes an unchecked, AI-flagged entry in the timeline", () => {
  const jobs = [];
  const c = T.fromAI([{ i: 0, type: "assessment", company: "Initech", role: "SWE" }], [mail("c0", "Initech (initech.io)", "Next steps", "", "2026-09-12")]);
  T.ingestEmails(jobs, c, newId);
  const x = T.mailEvents(jobs)[0];
  assert.strictEqual(x.ev.ai, 1);
  assert.ok(!x.ev.ok);
  assert.strictEqual(jobs[0].pipeline, "assessment");
});
