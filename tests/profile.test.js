/* node --test tests/  — pure resume logic, no browser needed */
const test = require("node:test");
const assert = require("node:assert");
globalThis.window = globalThis;
require("../profile.js");
const P = globalThis.NXProfile;

const RESUME = `Aarav Sharma
Bengaluru, India | aarav@example.com | github.com/aarav-dev | linkedin.com/in/aarav-sharma

EDUCATION
B.Tech in Computer Science, Example Institute of Technology, Expected 2026

SKILLS
Python, C++, JavaScript, TypeScript, React, Node.js, Express, MongoDB, PostgreSQL, Docker, Git
Machine Learning, Deep Learning, PyTorch, scikit-learn, pandas, NumPy, NLP, LLM, RAG, LangChain

PROJECTS
Resume Ranker - built an NLP pipeline in Python and PyTorch; served with FastAPI and deployed on Docker.
Trained a machine learning model with scikit-learn and PyTorch; tuned deep learning hyperparameters.
Carbon Track - full stack app using React, Node.js, Express and MongoDB with REST APIs.

EXPERIENCE
Software Engineering Intern, Acme Labs (Jun 2025 - Aug 2025): built React dashboards, wrote Python services.
`;
const NOW = new Date("2026-09-21");

test("extracts skills from a realistic resume", () => {
  const d = P.extractLocal(RESUME, NOW);
  const names = d.skills.map((s) => s.n);
  for (const want of ["python", "c++", "javascript", "typescript", "react", "node.js", "mongodb", "postgresql", "docker",
    "machine learning", "deep learning", "pytorch", "scikit-learn", "pandas", "nlp", "llm", "rag", "langchain", "fastapi"]) {
    assert.ok(names.includes(want), "missing skill: " + want + " in " + names.join(","));
  }
});

test("word boundaries: java is not javascript, c is not c++", () => {
  const d = P.extractLocal("I write JavaScript and TypeScript every day. Also some C++ and Go.", NOW);
  const names = d.skills.map((s) => s.n);
  assert.ok(names.includes("javascript"));
  assert.ok(!names.includes("java"), "javascript must not count as java");
  assert.ok(names.includes("c++"));
});

test("weights rise with repeated use", () => {
  const d = P.extractLocal(RESUME, NOW);
  const w = Object.fromEntries(d.skills.map((s) => [s.n, s.w]));
  assert.ok(w["pytorch"] >= 2, "pytorch appears several times");
  assert.ok(w["python"] >= 2);
  assert.strictEqual(w["docker"] >= 1, true);
});

test("detects a student, name, links and city", () => {
  const d = P.extractLocal(RESUME, NOW);
  assert.strictEqual(d.level, "student");
  assert.deepStrictEqual(d.jobTypes, ["internship", "new-grad"]);
  assert.strictEqual(d.name, "Aarav Sharma");
  assert.strictEqual(d.links.github, "aarav-dev");
  assert.strictEqual(d.links.linkedin, "aarav-sharma");
  assert.ok(d.locations.includes("bengaluru"));
  assert.ok(d.locations.includes("india"));
});

test("infers sensible target roles", () => {
  const roles = P.extractLocal(RESUME, NOW).roles;
  assert.ok(roles.includes("software engineer"));
  assert.ok(roles.includes("machine learning engineer"));
  assert.ok(roles.includes("full stack developer"));
});

test("an experienced profile is not called a student", () => {
  const d = P.extractLocal("Priya Rao\n6 years of experience building backend services in Java and Go.\nB.E. 2016\nSpring Boot, PostgreSQL, Kafka, AWS", NOW);
  assert.strictEqual(d.level, "senior");
  assert.deepStrictEqual(d.jobTypes, ["full-time"]);
});

test("empty / garbage input does not throw", () => {
  const d = P.extractLocal("", NOW);
  assert.deepStrictEqual(d.skills, []);
  assert.ok(d.roles.includes("software engineer"));
  assert.doesNotThrow(() => P.extractLocal(null, NOW));
});

test("sanitizeAI clamps hostile or malformed model output", () => {
  const evil = {
    name: "A".repeat(500), headline: "<script>alert(1)</script>", years_experience: 9999, level: "god-tier",
    skills: [{ name: "Python", weight: 99 }, { name: "  ReAcT ", weight: -5 }, "pytorch", { weight: 2 }, null, 42],
    roles: "not an array", job_types: ["internship", "world-domination"], locations: ["Pune", "P".repeat(200)],
    education: [{ school: "S", degree: "D", year: "2026" }, { school: "x".repeat(500) }],
    links: { github: "g".repeat(300) }
  };
  const c = P.sanitizeAI(evil);
  assert.ok(c.name.length <= 60);
  assert.ok(c.years <= 30);
  assert.strictEqual(c.level, "");
  assert.deepStrictEqual(c.skills.map((s) => [s.n, s.w]), [["python", 3], ["react", 1], ["pytorch", 1]]);
  assert.deepStrictEqual(c.roles, []);
  assert.deepStrictEqual(c.jobTypes, ["internship"]);
  assert.ok(c.locations.every((l) => l.length <= 40));
  assert.ok(c.education[1].school.length <= 90);
  assert.ok(c.links.github.length <= 60);
  assert.doesNotThrow(() => P.sanitizeAI(undefined));
  assert.doesNotThrow(() => P.sanitizeAI("string"));
});

test("mergeAI keeps AI skills primary and adds local-only ones at low weight", () => {
  const local = P.extractLocal(RESUME, NOW);
  const ai = P.sanitizeAI({ skills: [{ name: "pytorch", weight: 3 }, { name: "graph neural networks", weight: 2 }], level: "student", headline: "ML student", roles: ["ml engineer"] });
  const m = P.mergeAI(ai, local);
  const by = Object.fromEntries(m.skills.map((s) => [s.n, s.w]));
  assert.strictEqual(by["pytorch"], 3);
  assert.strictEqual(by["graph neural networks"], 2);
  assert.strictEqual(by["react"], 1, "local-only skill kept at weight 1");
  assert.strictEqual(m.headline, "ML student");
  assert.deepStrictEqual(m.roles, ["ml engineer"]);
});

test("applyDraft unions skills keeping the higher weight and does not wipe manual edits", () => {
  const p = P.blank();
  p.skills = [{ n: "python", w: 1 }, { n: "figma", w: 2 }];
  p.roles = ["ux engineer"];
  P.applyDraft(p, { skills: [{ n: "python", w: 3 }, { n: "react", w: 2 }], roles: ["software engineer"], locations: ["pune"], jobTypes: ["internship"], level: "student", name: "Aarav" });
  const by = Object.fromEntries(p.skills.map((s) => [s.n, s.w]));
  assert.strictEqual(by.python, 3);
  assert.strictEqual(by.figma, 2, "manual skill survives");
  assert.strictEqual(by.react, 2);
  assert.ok(p.roles.includes("ux engineer") && p.roles.includes("software engineer"));
  assert.strictEqual(p.name, "Aarav");
  assert.ok(p.locations.includes("pune"));
});

test("filtersFromProfile turns a profile into weighted matching rules", () => {
  const p = P.blank();
  p.skills = [{ n: "pytorch", w: 3 }, { n: "react", w: 1 }];
  p.roles = ["ml engineer"];
  p.jobTypes = ["internship"];
  p.locations = ["pune"]; p.remote = false; p.indiaOnly = true;
  const cur = { include: ["old"], exclude: ["senior", "sr ", "lead ", "sales"], levels: ["x"], minScore: 2, indiaOnly: false };
  const f = P.filtersFromProfile(p, cur);
  assert.deepStrictEqual(f.include.slice(0, 3), ["pytorch", "react", "ml engineer"]);
  assert.ok(f.weights.pytorch > f.weights.react, "core skill outweighs a listed one");
  assert.deepStrictEqual(f.levels, ["intern", "internship"]);
  assert.strictEqual(f.indiaOnly, true);
  assert.strictEqual(f.remoteOk, false);
  assert.strictEqual(f.minScore, 2, "unrelated settings preserved");
  assert.ok(f.exclude.includes("senior") && f.exclude.includes("sales"));
});

test("a senior profile stops excluding seniority words; a student keeps them", () => {
  const cur = { include: [], exclude: ["senior", "sr ", "staff ", " lead", "sales"], levels: [] };
  const s = P.blank(); s.skills = [{ n: "java", w: 2 }]; s.level = "senior"; s.jobTypes = ["full-time"];
  const fs = P.filtersFromProfile(s, cur);
  assert.ok(!fs.exclude.includes("senior") && fs.exclude.includes("sales"));
  const st = P.blank(); st.skills = [{ n: "java", w: 2 }];
  assert.ok(P.filtersFromProfile(st, cur).exclude.includes("senior"));
});
