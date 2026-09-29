import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiff, splitRows, buildTree, ago, mapPR, tok, parseGrep, mapIssue, fuzzy, autoGrid, hueOf, repoHue, quotePaths, withBridge, PAGE_BRIDGE } from "./lib.js";

test("diff parsing, split pairing, tree, PR mapping", () => {
  const [h] = parseDiff("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -3,3 +3,4 @@ fn\n a\n-b\n+B\n+C\n c\n\\ No newline at end of file\n");
  assert.deepEqual(h.rows.map((r) => [r.sign, r.o, r.n]), [[" ", 3, 3], ["-", 4, ""], ["+", "", 4], ["+", "", 5], [" ", 5, 6]]);
  assert.deepEqual(splitRows(h.rows).map((r) => r.l.k + r.r.k), ["  ", "-+", "x+", "  "]);

  const paths = ["README.md", "src/a.rs", "src/ui/b.rs"];
  assert.deepEqual(buildTree(paths, () => false).map((n) => n.path), ["README.md", "src"]);
  assert.deepEqual(buildTree(paths, (d) => d === "src").map((n) => n.path), ["README.md", "src", "src/a.rs", "src/ui"]);

  assert.equal(ago("2026-01-01T00:00:00Z", Date.parse("2026-01-01T03:00:00Z")), "3h ago");
  const pr = mapPR({ number: 7, state: "OPEN", isDraft: false, reviewDecision: "APPROVED", createdAt: new Date().toISOString(), author: { login: "a" },
    statusCheckRollup: [{ name: "test", status: "COMPLETED", conclusion: "FAILURE" }, { context: "ci", state: "PENDING" }], files: [{ path: "x", additions: 1, deletions: 2 }],
    reviewRequests: [{ __typename: "User", login: "bob" }, { __typename: "Team", slug: "core", name: "Core" }] });
  assert.deepEqual([pr.state, pr.review, pr.checks.map((c) => c.k), pr.files[0].dels, pr.reviewers], ["open", "Approved", ["fail", "pending"], 2, ["bob", "core"]]);
  const is = mapIssue({ number: 3, title: "t", state: "CLOSED", createdAt: new Date().toISOString(), labels: [{ name: "bug", color: "d73a4a" }], assignees: [{ login: "a" }], comments: [{ author: { login: "b" }, body: "hi", createdAt: new Date().toISOString() }] });
  assert.deepEqual([is.state, is.labels[0].color, is.assignees, is.comments[0].author], ["closed", "#d73a4a", ["a"], "b"]);
  assert.deepEqual(["lgn fx", "fix login", "#12", "zzz", ""].map((q) => fuzzy(q, "#12 Login fix feat/auth")), [true, true, true, false, true]);
  assert.deepEqual(parseGrep("x:y.txt\x002\x00  foo:bar hello\nu.txt\x001\x00hi\n"), [{ path: "x:y.txt", line: 2, text: "foo:bar hello" }, { path: "u.txt", line: 1, text: "hi" }]);
  assert.deepEqual(tok("let x = 1 // hi").map((t) => t.t), ["let", " ", "x", " ", "=", " ", "1", " ", "// hi"]);
});

test("every built-in theme sets every colour the UI uses", async () => {
  const { THEMES, KEYS } = await import("./themes.js");
  for (const t of THEMES) assert.deepEqual(Object.keys(t.vars).sort(), [...KEYS].sort(), t.id);
  const used = new Set();
  for (const f of ["App.jsx", "Review.jsx", "Wizard.jsx", "Boot.jsx", "Settings.jsx", "lib.js", "styles.css", "Term.jsx"])
    for (const m of (await import("node:fs")).readFileSync(new URL(f, import.meta.url), "utf8").matchAll(/var\((--[\w-]+)\)|cssVar\("(--[\w-]+)"\)/g)) used.add(m[1] || m[2]);
  const missing = [...used].filter((k) => !KEYS.includes(k) && !["--line", "--code-size"].includes(k));
  assert.deepEqual(missing, [], "colours used in the UI but not defined by themes");
});

test("what's new lists the changelog sections since the last version seen", async () => {
  const { sectionsSince, parseChangelog } = await import("./lib.js");
  const md = "# C\n\n## 0.3.0 — d3\n- c\n\n## 0.2.10 — d2\n- b1\n- b2\n\n## 0.2.0 — d1\n- a\n";
  assert.deepEqual(parseChangelog(md)[1], { version: "0.2.10", date: "d2", items: ["b1", "b2"] });
  const v = (s) => s.map((x) => x.version);
  assert.deepEqual(v(sectionsSince(md, "0.2.0", "0.3.0")), ["0.3.0", "0.2.10"]);
  assert.deepEqual(v(sectionsSince(md, "0.2.0", "0.2.10")), ["0.2.10"], "never shows notes for a version not installed yet");
  assert.deepEqual(v(sectionsSince(md, null, "0.3.0")), ["0.3.0"], "unknown previous version: just this one");
  const real = (await import("node:fs")).readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const pkg = JSON.parse((await import("node:fs")).readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(parseChangelog(real).every((s) => /^\d+\.\d+\.\d+$/.test(s.version) && s.items.length), "every CHANGELOG section has a version and entries");
  assert.ok(parseChangelog(real).some((s) => s.version === pkg.version), "CHANGELOG has a section for the current version");
});

test("reserve groups: own groups, last session, day buckets, other", async () => {
  const { reserveGroups } = await import("./lib.js");
  const now = Date.parse("2026-09-26T12:00:00Z"), h = 3600e3;
  const repos = ["api", "web", "dots", "infra", "old", "notes"].map((id) => ({ id }));
  const used = { api: now - 1 * h, web: now - 30 * h, dots: now - 5 * 24 * h, old: now - 40 * 24 * h, notes: now - 2 * h };
  const shape = (gs) => gs.map((g) => [g.label, g.items.map((x) => x.id)]);
  assert.deepEqual(shape(reserveGroups(repos, { used, lastSet: ["web", "api"], days: [7, 3], groups: [{ name: "Work", repos: ["notes"] }], now })), [
    ["Work", ["notes"]], ["Last used", ["api", "web"]], ["Last 7 days", ["dots"]], ["Other", ["infra", "old"]],
  ], "a repo lands in one group only, and empty buckets are left out");
  assert.deepEqual(shape(reserveGroups(repos, { used, days: [1, 3], now })), [
    ["Last 1 day", ["api", "notes"]], ["Last 3 days", ["web"]], ["Other", ["dots", "infra", "old"]],
  ]);
  assert.deepEqual(shape(reserveGroups(repos.slice(0, 2), { now })), [["", ["api", "web"]]], "nothing to split: one unlabeled list");
  assert.deepEqual(shape(reserveGroups([], { groups: [{ name: "Empty", repos: [] }], now })), [["Empty", []]], "your own groups show even when empty");
});

test("others active: latest per person, what they did, branches they pushed", async () => {
  const { othersActive } = await import("./lib.js");
  const now = Date.parse("2026-09-26T12:00:00Z"), at = (h) => new Date(now - h * 3600e3).toISOString();
  const ev = [
    { login: "ada", at: at(2), type: "PullRequestEvent", action: "opened", num: 12 },
    { login: "ada", at: at(30), type: "PushEvent", ref: "feat/login" },
    { login: "me", at: at(1), type: "PushEvent", ref: "main" },
    { login: "dependabot[bot]", at: at(1), type: "PushEvent", ref: "deps" },
    { login: "bob", at: at(24 * 8), type: "PushEvent", ref: "main" },
    { login: "cy", at: at(50), type: "PullRequestReviewEvent", num: 9 },
  ];
  assert.deepEqual(othersActive(ev, "me", 7, now), [
    { login: "ada", at: at(2), what: "opened PR #12", branches: ["feat/login"] },
    { login: "cy", at: at(50), what: "reviewed PR #9", branches: [] },
  ]);
  assert.deepEqual(othersActive(ev, "me", 1, now).map((x) => x.login), ["ada"]);
});

test("pastel: hex colours, light bar over a dark tint", async () => {
  const { pastel } = await import("./lib.js");
  const p = pastel(200);
  assert.ok(Object.values(p).every((c) => /^#[0-9a-f]{6}$/.test(c)));
  assert.equal(pastel(0).bar, "#f0a8a8");
  assert.ok(parseInt(p.bar.slice(1, 3), 16) > parseInt(p.bg.slice(1, 3), 16));
});

test("snap zones: edges, grids, dock, off", async () => {
  const { snapZone } = await import("./lib.js");
  const z = (x, y, g) => snapZone(x, y, 1000, 826, g);
  assert.deepEqual(z(5, 400), { x: 4, y: 4, w: 494, h: 792 }, "left edge: left half");
  assert.deepEqual(z(995, 400), { x: 502, y: 4, w: 494, h: 792 }, "right edge: right half");
  assert.deepEqual(z(5, 10), { x: 4, y: 4, w: 494, h: 394 }, "top-left corner: quarter");
  assert.deepEqual(z(995, 780), { x: 502, y: 402, w: 494, h: 394 }, "bottom-right corner: quarter");
  assert.deepEqual(z(500, 5), { x: 4, y: 4, w: 992, h: 792 }, "top edge: fill");
  assert.equal(z(500, 400), null, "middle: stays where dropped");
  assert.equal(z(500, 820), "dock");
  assert.deepEqual(z(500, 400, "3x2"), { x: 336, y: 402, w: 328, h: 394 }, "3×2: middle column, bottom row");
  assert.deepEqual(z(999, 0, "3x3"), { x: 668, y: 4, w: 328, h: 261 }, "far corner stays inside the grid");
  assert.equal(z(500, 820, "3x3"), "dock", "the bottom edge docks in every layout");
  assert.equal(z(5, 400, "off"), null);
});

test("overlaps: neighbouring cells don't count, covering does", async () => {
  const { overlaps, snapZone } = await import("./lib.js");
  const left = snapZone(5, 400, 1000, 826), right = snapZone(995, 400, 1000, 826), full = snapZone(500, 5, 1000, 826);
  assert.equal(overlaps(left, right), false);
  assert.equal(overlaps(full, left), true);
  assert.equal(overlaps({ x: 0, y: 0, w: 100, h: 100 }, { x: 95, y: 0, w: 100, h: 100 }), false, "a few px of touching is fine");
});

test("dual-screen tiling and repo colours", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 7, 10].map((n) => { const g = autoGrid(n); return `${g.cols}x${g.rows}`; }),
    ["1x1", "1x1", "2x1", "2x2", "2x2", "3x2", "3x3", "4x3"]);
  const h = hueOf("nimbus");
  assert.ok(h >= 0 && h < 360 && Number.isInteger(h));
  assert.equal(hueOf("nimbus"), h);
  assert.notEqual(hueOf("api"), h);
});

test("repos in the list get clearly different hues", () => {
  const list = ["a", "b", "c", "d", "e", "f", "g", "h"], hues = list.map((id) => repoHue(id, list));
  for (const [i, h] of hues.entries()) for (const g of hues.slice(i + 1)) assert.ok(Math.min(Math.abs(h - g), 360 - Math.abs(h - g)) >= 30, `${h} vs ${g}`);
  assert.equal(repoHue("zz", list), hueOf("zz"), "a repo not in the list falls back to its name");
});

test("project CLAUDE.md: reporting target and repo list that can grow", async () => {
  const { projectMd, withRepos } = await import("./lib.js");
  const md = projectMd({ name: "Launch", goal: "Ship it", repos: [{ id: "api", remote: "me/api" }], report: { kind: "issue", repo: "me/api", issue: "" } });
  assert.match(md, /- `api\/` \(github.com\/me\/api\)/);
  assert.match(md, /open one titled "Launch"/);
  assert.match(md, /issue body is the project.s report[\s\S]*Outstanding, Difficulties/, "the issue holds the same report as the HTML page");
  assert.match(projectMd({ name: "L", goal: "", repos: [], report: { kind: "issue", repo: "me/api", issue: "7" } }), /\*\*me\/api#7\*\*/);
  const edited = md.replace("Ship it", "Ship it now");
  const more = withRepos(edited, [{ id: "api", remote: "me/api" }, { id: "web", remote: "" }]);
  assert.match(more, /- `web\/`\n<!-- \/nimbus:repos -->/);
  assert.match(more, /Ship it now/, "your edits survive adding repos");
  assert.match(projectMd({ name: "L", goal: "", repos: [], report: { kind: "html" } }), /REPORT\.html/);
  assert.match(md, /1\. \*\*Start\*\* \(`start`\)[\s\S]*5\. \*\*Merge\*\* \(`merge`\)/, "phases listed in order with the ids .nimbus-project.json uses");
  assert.match(md, /Start → \*\*Development\*\* → Testing/, "report opens with the phase line");
  assert.match(md, /\*\*Start\*\*[^\n]*sprints[^\n]*stacked PRs/, "the plan splits a big goal into sprints and stacked PRs");
  const { claudeCmd } = await import("./lib.js");
  assert.equal(claudeCmd(" "), "claude");
  assert.equal(claudeCmd("it's\nnext"), "claude 'it'\\''s next'");
  assert.equal(claudeCmd("go", "/o'k/nimbus"), `claude 'go' --mcp-config '{"mcpServers":{"nimbus":{"command":"/o'\\''k/nimbus","args":["mcp"]}}}' --allowedTools mcp__nimbus`);
});

test("dropped paths are shell-quoted", () => {
  assert.equal(quotePaths(["/a b/x.png", "/it's.jpg"]), "'/a b/x.png' '/it'\\''s.jpg' ");
});

test("page bridge goes after <head> or the doctype, never before", () => {
  const B = PAGE_BRIDGE;
  assert.equal(withBridge("<!doctype html><html><head><title>x</title>"), "<!doctype html><html><head>" + B + "<title>x</title>");
  assert.equal(withBridge('<head lang="en"><header>'), '<head lang="en">' + B + "<header>");
  assert.equal(withBridge("<!DOCTYPE html><body><header>"), "<!DOCTYPE html>" + B + "<body><header>");
  assert.equal(withBridge("<p>hi"), B + "<p>hi");
});
