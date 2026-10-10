import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiff, splitRows, buildTree, ago, mapPR, mapLineComment, splitDiff, tok, parseGrep, mapIssue, fuzzy, autoGrid, hueOf, repoHue, quotePaths, withBridge, PAGE_BRIDGE } from "./lib.js";

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
  // a later plain comment does not withdraw a verdict; without reviewDecision (no branch protection) the verdicts decide
  const rv = mapPR({ number: 8, state: "OPEN", createdAt: new Date().toISOString(), comments: [{ author: { login: "a" }, body: "fixed", createdAt: "2026-01-03T00:00:00Z" }], reviews: [
    { author: { login: "bob" }, state: "APPROVED", body: "", submittedAt: "2026-01-01T00:00:00Z" },
    { author: { login: "bob" }, state: "CHANGES_REQUESTED", body: "rename it", submittedAt: "2026-01-02T00:00:00Z" },
    { author: { login: "bob" }, state: "COMMENTED", body: "", submittedAt: "2026-01-04T00:00:00Z" }] });
  assert.deepEqual([rv.review, rv.verdicts, rv.thread.map((c) => [c.author, c.verdict, c.body])], ["Changes requested", [{ who: "bob", verdict: "changes requested" }], [["bob", "approved", ""], ["bob", "changes requested", "rename it"], ["a", undefined, "fixed"]]]);
  assert.deepEqual(mapLineComment({ user: { login: "bob" }, body: "why?", created_at: "x", path: "a.js", line: null, original_line: 4 }), { author: "bob", body: "why?", at: "x", path: "a.js", line: 4 });
  const sd = splitDiff("diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/d/y b/d/y\n@@ -1 +0,0 @@\n-gone\n");
  assert.deepEqual([Object.keys(sd), parseDiff(sd["x.js"])[0].rows.map((r) => r.sign), parseDiff(sd["d/y"]).length], [["x.js", "d/y"], ["-", "+"], 1]);
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
  assert.match(md, /issue body is the project.s report[\s\S]*the pipeline: one section per phase[\s\S]*Blockers & risks/, "the issue report has the pipeline layout");
  assert.match(projectMd({ name: "L", goal: "", repos: [], report: { kind: "issue", repo: "me/api", issue: "7" } }), /\*\*me\/api#7\*\*/);
  const edited = md.replace("Ship it", "Ship it now");
  const more = withRepos(edited, [{ id: "api", remote: "me/api" }, { id: "web", remote: "" }]);
  assert.match(more, /- `web\/`\n<!-- \/nimbus:repos -->/);
  assert.match(more, /Ship it now/, "your edits survive adding repos");
  assert.match(projectMd({ name: "L", goal: "", repos: [], report: { kind: "html" } }), /REPORT\.html/);
  assert.match(md, /1\. \*\*Start\*\* \(`start`\)[\s\S]*5\. \*\*Merge\*\* \(`merge`\)/, "phases listed in order with the ids .nimbus-project.json uses");
  assert.match(md, /✓ Start → ● Development → ○ Testing/, "report opens with the phase line");
  const { reportSeed } = await import("./lib.js");
  const seed = reportSeed({ name: "L", goal: " go ", repos: [{ id: "api", remote: "me/api" }] });
  assert.deepEqual(seed.stages.map((x) => x.status), ["active", "pending", "pending", "pending", "pending"], "the seed report starts in the Start phase");
  assert.equal(seed.project.repos[0].name, "me/api");
  assert.match(md, /\*\*Start\*\*[^\n]*sprints[^\n]*stacked PRs/, "the plan splits a big goal into sprints and stacked PRs");
  const { claudeCmd } = await import("./lib.js");
  assert.equal(claudeCmd(" "), "claude");
  assert.equal(claudeCmd("it's\nnext"), "claude 'it'\\''s next'");
  const cmd = claudeCmd("go", "/o'k/nimbus");
  assert.ok(cmd.startsWith(`claude 'go' --mcp-config '{"mcpServers":{"nimbus":{"command":"/o'\\''k/nimbus","args":["mcp"]}}}' --allowedTools mcp__nimbus --settings '`));
  const settings = JSON.parse(cmd.split(" --settings ")[1].slice(1, -1).replaceAll("'\\''", "'"));
  assert.equal(settings.hooks.Stop[0].hooks[0].command, "'/o'\\''k/nimbus' hook done", "hook runs nimbus, quoted for the shell");
});

test("a project's worktrees: <repo>@<project> on a branch named after the project", async () => {
  const { projBranch, projTree, treeRepo, projectMd } = await import("./lib.js");
  assert.equal(projBranch(" New  login "), "New-login");
  assert.equal(projTree("api", "New login"), "api@New-login");
  assert.equal(treeRepo("api@New-login"), "api");
  assert.equal(treeRepo("api"), "api");
  assert.match(projectMd({ name: "New login", goal: "", repos: [{ id: "api", remote: "" }], report: { kind: "html" } }), /worktree on the branch `New-login`[\s\S]*- `api\/`/);
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
test("experiment results: parsing forgives sloppy rows, stats follow the direction", async () => {
  const { RESULTS_HEADER, parseResults, resultStats, chartGeom } = await import("./lib.js");
  assert.deepEqual(parseResults(""), { rows: [], skipped: 0 });
  assert.deepEqual(parseResults(RESULTS_HEADER), { rows: [], skipped: 0 });
  const tsv = RESULTS_HEADER + "a1\t10\tkeep\tbaseline\r\nb2\t12\tdiscard\twider\tand deeper\nc3\t\tcrash\tOOM\nd4\t8\tkeep\tsmaller\n\nshort\t1\ne5\t1\tmaybe\tx\nf6\tfast\tkeep\tx\n";
  const { rows, skipped } = parseResults(tsv);
  assert.equal(skipped, 3, "a short row, an unknown status and a non-numeric metric are counted, not shown");
  assert.deepEqual(rows.map((r) => [r.commit, r.metric, r.status]), [["a1", 10, "keep"], ["b2", 12, "discard"], ["c3", null, "crash"], ["d4", 8, "keep"]]);
  assert.equal(rows[1].description, "wider and deeper", "a tab in the description doesn't lose the row");
  assert.equal(parseResults("a1\t10\tkeep\tbaseline\n").rows.length, 1, "a missing header doesn't eat the first row");

  const lo = resultStats(rows, "lower");
  assert.deepEqual([lo.baseline, lo.best, lo.change, lo.kept, lo.discarded, lo.crashed], [10, 8, -20, 2, 1, 1]);
  assert.deepEqual(lo.frontier, [10, 10, 10, 8], "discards and crashes never move the frontier");
  const hi = resultStats(rows, "higher");
  assert.deepEqual([hi.best, hi.frontier], [10, [10, 10, 10, 10]]);
  assert.deepEqual(resultStats([], "lower"), { baseline: null, best: null, change: null, kept: 0, discarded: 0, crashed: 0, frontier: [] });

  const one = [{ commit: "a", metric: 2, status: "keep", description: "" }];
  assert.deepEqual(chartGeom(one, [2]), { dots: [{ x: 400, y: 188, status: "keep" }], path: "M400,188" }, "one result is a dot in the middle, not NaN");
  const two = [{ metric: 1, status: "keep" }, { metric: 3, status: "discard" }];
  assert.deepEqual(chartGeom(two, [1, 1]), { dots: [{ x: 12, y: 188, status: "keep" }, { x: 788, y: 12, status: "discard" }], path: "M12,188H788V188" });
  const flat = chartGeom([{ metric: 5, status: "keep" }, { metric: 5, status: "discard" }, { metric: null, status: "crash" }], [5, 5, 5]);
  assert.ok(flat.dots.every((d) => Number.isFinite(d.x) && Number.isFinite(d.y)), "equal metrics and a crash still have coordinates");
});
test("experiment harness: run.sh reports the metric or the crash, the allowlist stays inside the repo", async () => {
  const { runSh, experimentSettings, filesBad, metricBad } = await import("./lib.js");
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const { tmpdir } = await import("node:os"), { join } = await import("node:path");
  const d = mkdtempSync(join(tmpdir(), "nimbus-run-"));
  mkdirSync(join(d, "it's repo"));
  const out = (command, metric = "", budget = 5) => {
    writeFileSync(join(d, "run.sh"), runSh({ command, metric, budget }, "it's repo"), { mode: 0o755 });
    return spawnSync(join(d, "run.sh"), { encoding: "utf8" }).stdout;
  };
  assert.equal(out(`echo "it's $((1+1)) time: 3.5"; echo 'time: 1.5 s'`, "time:\\s+([\\d.]+)"), "metric: 1.5\n", "quotes and $ run as typed; the last match wins");
  assert.equal(out("echo took 7 steps, loss 0.25"), "metric: 0.25\n", "no regex: the last number printed");
  assert.equal(out("echo delta -3"), "metric: -3\n");
  assert.equal(out("echo loss 3.2e-05"), "metric: 3.2e-05\n", "scientific notation is one number, not its mantissa");
  assert.match(out("echo boom; exit 3"), /^crash: exit 3\nboom\n/, "a crash shows the end of the log");
  assert.equal(out("echo nothing here", "x=(\\d+)").split("\n")[0], "crash: no metric");
  assert.equal(out("sleep 5", "", 1).split("\n")[0], "crash: timeout");
  rmSync(d, { recursive: true });

  const s = experimentSettings({ files: ["src/*.rs"], budget: 300 }, "demo", "/w/demo@p");
  assert.deepEqual(s.env, { BASH_DEFAULT_TIMEOUT_MS: "330000", BASH_MAX_TIMEOUT_MS: "330000" }, "Claude's Bash tool gives up after 2 minutes by default: it must outlast a run");
  assert.deepEqual(Object.keys(s.permissions), ["allow"], "no additionalDirectories: Claude Code ignores it in a project's settings, claudeCmd passes --add-dir");
  const { claudeCmd } = await import("./lib.js");
  assert.equal(claudeCmd("go", null, ["/w/it's@p"]), "claude 'go' --add-dir '/w/it'\\''s@p'", "the worktree is a symlink out of the project folder: without --add-dir every edit in it is denied");
  assert.ok(claudeCmd("go", "/nimbus", ["/w/demo@p"]).endsWith(" --add-dir '/w/demo@p'"), "last, after the other flags");
  assert.ok(claudeCmd("", "/nimbus", ["/w/demo@p"], true).endsWith(" --add-dir '/w/demo@p' --continue"), "started anew, it picks the conversation up");
  const { osc52 } = await import("./lib.js");
  assert.equal(osc52("c;" + Buffer.from("blå ☁").toString("base64")), "blå ☁", "what a program copies, UTF-8");
  assert.deepEqual([osc52("c;?"), osc52("c;%%"), osc52("c;")], [null, null, null], "reading the clipboard, junk and nothing are ignored");
  assert.deepEqual(s.permissions.allow.slice(0, 4), ["Edit(demo/src/*.rs)", "Edit(//w/demo@p/src/*.rs)", "Edit(results.tsv)", "Bash(./run.sh)"]);
  assert.ok(s.permissions.allow.includes("Bash(git -C demo reset:*)") && !s.permissions.allow.some((r) => /push|Bash\(git:|Bash\(\*/.test(r)), "git is allowed per subcommand, and not push");

  assert.equal(filesBad(["src/a.rs", "lib/**"]), "");
  for (const f of [[], ["../other/**"], ["/etc/passwd"], ["src/../../x"], ["a(b)"]]) assert.ok(filesBad(f), JSON.stringify(f) + " is refused");
  assert.equal(metricBad(""), "");
  assert.equal(metricBad("time: (?:about )?([\\d.]+)"), "");
  for (const re of ["time: [\\d.]+", "(a)(b)", "(unclosed"]) assert.ok(metricBad(re), re + " is refused");
});
test("experiment CLAUDE.md names the repo, the files, the direction and the exact commands the allowlist covers", async () => {
  const { experimentMd, experimentSettings, EXPERIMENT_START, EXPERIMENT_RESUME } = await import("./lib.js");
  const ex = { files: ["src/parse.rs", "src/lex/*.rs"], command: "cargo bench parse", metric: "", direction: "higher", budget: 300 };
  const md = experimentMd({ name: "Faster parse", goal: " parse faster ", repo: { id: "demo", remote: "me/demo" }, experiment: ex });
  assert.match(md, /^# Experiment: Faster parse\n/);
  assert.match(md, /`demo\/` \(github\.com\/me\/demo\)[^\n]*branch `Faster-parse`/);
  assert.match(md, /`demo\/src\/parse\.rs`, `demo\/src\/lex\/\*\.rs`/);
  assert.match(md, /\*\*higher is better\.\*\*/i);
  assert.match(md, /at most 300 seconds/);
  assert.match(md, /## Goal\n\nparse faster\n/);
  for (const rule of experimentSettings(ex, "demo", "/w/demo@Faster-parse").permissions.allow.filter((r) => r.startsWith("Bash(git")))
    assert.ok(md.includes(rule.slice(5, -3)), "CLAUDE.md shows `" + rule.slice(5, -3) + "` so Claude's commands match the rule");
  assert.match(experimentMd({ name: "L", goal: "", repo: { id: "demo" }, experiment: { ...ex, direction: "lower" } }), /\*\*lower is better\.\*\*/i);
  assert.ok(EXPERIMENT_START.includes("CLAUDE.md") && EXPERIMENT_RESUME.includes("results.tsv"));
});

test("writer: git's porcelain word diff becomes lines of runs", async () => {
  const { parseWordDiff, allAdded, PROSE, PROSE_RE } = await import("./lib.js");
  const out = "diff --git a/a.md b/a.md\nindex dbeeec6..8e708ff 100644\n--- a/a.md\n+++ b/a.md\n@@ -1,6 +1,8 @@\n # Install\n~\n \n~\n Run the installer \n-script, which will set\n+and it sets\n  up the \n-application.\n+app.\n~\n~\n++ plus item\n~\n -- kept list item\n~\n ~\n~\n\\ No newline at end of file\n";
  const d = parseWordDiff(out);
  assert.deepEqual(d.lines[0], [{ t: " ", s: "# Install" }], "headers before @@ are skipped");
  assert.deepEqual(d.lines[1], [], "an empty source line");
  assert.deepEqual(d.lines[2].map((r) => r.t + r.s), [" Run the installer ", "-script, which will set", "+and it sets", "  up the ", "-application.", "+app."]);
  assert.deepEqual(d.lines[3], [], "an inserted blank line is a lone ~");
  assert.deepEqual(d.lines[4], [{ t: "+", s: "+ plus item" }], "only the first character is the marker");
  assert.deepEqual(d.lines[5], [{ t: " ", s: "-- kept list item" }]);
  assert.deepEqual(d.lines[6], [{ t: " ", s: "~" }], "a text line that is a tilde is not a newline");
  assert.equal(d.lines.length, 7, "no trailing empty line, and the no-newline note is skipped");
  assert.deepEqual([d.added, d.removed], [7, 5], "words in the + and - runs");

  const gone = parseWordDiff("diff --git a/x.md b/x.md\ndeleted file mode 100644\n--- a/x.md\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-One two\n~\n-three\n~\n");
  assert.deepEqual([gone.lines.length, gone.added, gone.removed], [2, 0, 3], "a deleted file is all removed");
  assert.deepEqual(parseWordDiff("diff --git a/i.md b/i.md\nBinary files differ\n"), { lines: [], added: 0, removed: 0 }, "no hunk, no lines");

  const fresh = allAdded("# New\n\nTwo words\n");
  assert.deepEqual(fresh.lines, [[{ t: "+", s: "# New" }], [], [{ t: "+", s: "Two words" }]]);
  assert.deepEqual([fresh.added, fresh.removed], [4, 0]);

  assert.ok(PROSE.includes("*.md") && PROSE.includes("*.tex"));
  assert.ok(PROSE_RE.test("docs/sub/læring.MD") && PROSE_RE.test("notes.txt"));
  assert.ok(!PROSE_RE.test("src/a.js") && !PROSE_RE.test("md"));
});

test("writer CLAUDE.md: focus on the text, a commit per revision, a repo list that can grow", async () => {
  const { writerMd, withRepos, WRITER_START, WRITER_RESUME } = await import("./lib.js");
  const md = writerMd({ name: "Install guide", goal: " A guide for people new to terminals ", repos: [{ id: "docs", remote: "me/docs" }] });
  assert.match(md, /^# Writing: Install guide\n/);
  assert.match(md, /- `docs\/` \(github.com\/me\/docs\)/);
  assert.match(md, /branch `Install-guide`/);
  assert.match(md, /## Goal\n\nA guide for people new to terminals\n/);
  assert.match(md, /Change code when the text needs it/, "code is allowed, the text is the focus");
  assert.match(md, /Commit each revision on its own/);
  assert.match(md, /set_report/, "it reports through the workfolder report");
  assert.doesNotMatch(md, /REPORT\.html|Phases/);
  assert.match(writerMd({ name: "L", goal: "", repos: [] }), /not written yet/);
  assert.match(withRepos(md, [{ id: "docs", remote: "me/docs" }, { id: "site", remote: "" }]), /- `site\/`\n<!-- \/nimbus:repos -->/);
  assert.ok(WRITER_START && WRITER_RESUME && WRITER_START !== WRITER_RESUME);
});

test("writer CLAUDE.md: Claude settles where the text lives and records it in the project file", async () => {
  const { writerMd, WRITER_START } = await import("./lib.js");
  const md = writerMd({ name: "Help pages", goal: "", repos: [{ id: "web", remote: "" }] });
  assert.match(md, /## Where the text lives/);
  assert.match(md, /"files": \["src\/pages\/\*\.jsx", "locales\/en\.json"\]/, "an example of the setting Nimbus reads");
  assert.match(md, /\.nimbus-project\.json/);
  assert.match(WRITER_START, /where it lives/);
  assert.match(md, /## Why each change/);
  assert.match(md, /"notes": \[\n  \{ "file": "guide\.md", "at": /, "an example of the notes the Text tab shows beside the changes");
});

test("writer: only the changed paragraphs are shown, under their heading, with the notes beside them", async () => {
  const { proseView } = await import("./lib.js");
  const same = (s) => [{ t: " ", s }], L = (...rs) => rs.map((r) => ({ t: r[0], s: r.slice(1) }));
  const lines = [
    same("# Guide"), [], same("Intro stays."), [],
    same("## Install"), [], same("Untouched paragraph."), [],
    same("Run the installer,"), L(" which ", "-will set", "+sets", "  up the app."), [],
    L("+A new paragraph."), [],
    same("## Later"), [], same("Tail."),
  ];
  const rows = proseView(lines, [
    { at: "sets up the app", why: "Shorter." },
    { at: "will set up", why: "Old wording matches too." },
    { why: "Whole file." },
    { at: "no longer there", why: "Stale." },
    { at: "A new", why: 7 },
    null,
  ]);
  const text = (r) => (r.gap ? "…" : r.l.map((x) => x.s).join(""));
  assert.deepEqual(rows.map(text), ["…", "## Install", "…", "Run the installer,", "which will setsets up the app.", "", "A new paragraph.", "…"],
    "the heading above, the whole hard-wrapped paragraph, a blank line between neighbours, a gap where text is skipped");
  assert.deepEqual(rows[1].why, ["Whole file."], "a note without a quote sits on the first line shown");
  assert.deepEqual(rows[4].why, ["Shorter.", "Old wording matches too."], "a quote is looked for in the new text, then the old");
  assert.ok(rows.every((r, i) => i === 1 || i === 4 || !r.why), "a stale or malformed note is dropped");

  const fresh = proseView([L("+# New"), [], L("+All of it.")]);
  assert.deepEqual(fresh.map(text), ["# New", "", "All of it."], "a new file shows in full, no gaps");
  assert.deepEqual(proseView([]), []);
});

test("switching session saves what was showing and returns what to show", async () => {
  const { switchSession } = await import("./lib.js");
  // first time: what is showing becomes Default, the new session starts empty
  const a = switchSession(undefined, ["api", "web"], "Hobby");
  assert.deepEqual(a, { sessions: { current: "Hobby", list: [{ name: "Default", repos: ["api", "web"] }, { name: "Hobby", repos: [] }] }, show: [] });
  // back: Hobby keeps what it had out, Default comes back as it was left; a repo can be in both
  const b = switchSession(a.sessions, ["game", "web"], "Default");
  assert.deepEqual(b.show, ["api", "web"]);
  assert.deepEqual(b.sessions, { current: "Default", list: [{ name: "Default", repos: ["api", "web"] }, { name: "Hobby", repos: ["game", "web"] }] });
  // to the one you are in: nothing moves
  assert.deepEqual(switchSession(b.sessions, ["api"], "Default").show, ["api"]);
});

test("the development phase asks for screenshots on PRs that change the UI", async () => {
  const { PHASES } = await import("./lib.js");
  assert.match(PHASES.find((p) => p.id === "dev").does, /pr-screenshots/);
});
