import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiff, splitRows, buildTree, ago, mapPR, tok } from "./lib.js";

test("diff parsing, split pairing, tree, PR mapping", () => {
  const [h] = parseDiff("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -3,3 +3,4 @@ fn\n a\n-b\n+B\n+C\n c\n\\ No newline at end of file\n");
  assert.deepEqual(h.rows.map((r) => [r.sign, r.o, r.n]), [[" ", 3, 3], ["-", 4, ""], ["+", "", 4], ["+", "", 5], [" ", 5, 6]]);
  assert.deepEqual(splitRows(h.rows).map((r) => r.l.k + r.r.k), ["  ", "-+", "x+", "  "]);

  const paths = ["README.md", "src/a.rs", "src/ui/b.rs"];
  assert.deepEqual(buildTree(paths, () => false).map((n) => n.path), ["README.md", "src"]);
  assert.deepEqual(buildTree(paths, (d) => d === "src").map((n) => n.path), ["README.md", "src", "src/a.rs", "src/ui"]);

  assert.equal(ago("2026-01-01T00:00:00Z", Date.parse("2026-01-01T03:00:00Z")), "3h ago");
  const pr = mapPR({ number: 7, state: "OPEN", isDraft: false, reviewDecision: "APPROVED", createdAt: new Date().toISOString(), author: { login: "a" },
    statusCheckRollup: [{ name: "test", status: "COMPLETED", conclusion: "FAILURE" }, { context: "ci", state: "PENDING" }], files: [{ path: "x", additions: 1, deletions: 2 }] });
  assert.deepEqual([pr.state, pr.review, pr.checks.map((c) => c.k), pr.files[0].dels], ["open", "Approved", ["fail", "pending"], 2]);
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
