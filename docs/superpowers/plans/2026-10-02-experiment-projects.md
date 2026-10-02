# Experiment Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project kind where Claude loops unattended on one repo: edit, run a command, read one number, keep the commit if it improved, reset if not, log every try.

**Architecture:** An experiment is a project with `kind: "experiment"` in `.nimbus-project.json`. Nimbus generates five files into the project folder (`CLAUDE.md`, `run.sh`, `results.tsv`, `.claude/settings.json`, the config) from pure functions in `src/lib.js`; Claude runs the loop itself in a terminal. The project page renders `results.tsv` as a chart and table.

**Tech Stack:** React 19 (inline styles, no CSS framework), Tauri 2 / Rust, `node --test`, POSIX `sh` + `timeout` + `perl` for the harness.

**Spec:** `docs/superpowers/specs/2026-10-02-experiment-projects-design.md`

## Global Constraints

- No new dependencies, in `package.json` or `Cargo.toml`.
- Pure logic goes in `src/lib.js` and is tested in `src/lib.test.js`; components stay thin.
- Match the surrounding code: dense one-line helpers, a `/** */` doc line per export, inline `style={{}}`, Phosphor icons through `<I n="ph-…" />`.
- No animated CSS filters and no animation in the chart (WebKitGTK pegs a core on them).
- A project without `kind` is a phase project and must behave exactly as before.
- `status` in `results.tsv` is one of `keep`, `discard`, `crash`. `direction` is `lower` or `higher`. `budget` is seconds.
- Do not bump `VERSION` or `CHANGELOG.md`: pushing those to `main` publishes a release, which is the user's call.

## Review Focus

1. **One result, or every result equal.** The chart must draw a dot, not `NaN` coordinates. Pinned in Task 1 (`chartGeom`).
2. **A `results.tsv` Claude wrote sloppily**: CRLF line ends, a blank last line, a tab inside the description, a header that is missing. Rows that can be read are shown; the rest are counted. Pinned in Task 1 (`parseResults`).
3. **An editable-files entry that escapes the repo** (`../other/**`, `/etc/x`). It would become a permission rule, so the dialog must refuse it. Pinned in Task 2 (`filesBad`).
4. **A run command with quotes and `$`** (`echo "it's $((1+1))"`). It must run as typed. Pinned in Task 2 (the `run.sh` test).
5. **A command that hangs, or prints the metric several times.** Hang gives `crash: timeout` within the budget; the last printed metric wins. Pinned in Task 2 (the `run.sh` test).

---

### Task 1: Reading results

**Files:**
- Modify: `src/lib.js` (append at the end)
- Test: `src/lib.test.js` (append at the end)

**Interfaces:**
- Produces:
  - `RESULTS_HEADER: string`, the TSV header line with a trailing newline
  - `parseResults(tsv: string) → { rows: Row[], skipped: number }` where `Row = { commit: string, metric: number | null, status: "keep" | "discard" | "crash", description: string }`
  - `resultStats(rows: Row[], direction: "lower" | "higher") → { baseline: number | null, best: number | null, change: number | null, kept: number, discarded: number, crashed: number, frontier: (number | null)[] }`. `change` is percent against the baseline; `frontier[i]` is the best kept metric after row `i`.
  - `chartGeom(rows: Row[], frontier: (number | null)[], W = 800, H = 200, pad = 12) → { dots: { x: number, y: number, status: string }[], path: string }`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test`
Expected: FAIL, `parseResults is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib.js`:

```js
// ---- experiments: a project where Claude loops on one metric (see docs/superpowers/specs/2026-10-02-experiment-projects-design.md) ----

/** results.tsv as an experiment starts: Claude appends a row per try. */
export const RESULTS_HEADER = "commit\tmetric\tstatus\tdescription\n";

/** results.tsv → the rows that can be read, and how many couldn't (Claude writes this file by hand). */
export function parseResults(tsv) {
  const rows = [];
  let skipped = 0;
  for (const line of tsv.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("commit\t")) continue;
    const [commit, metric, status, ...rest] = line.split("\t"), v = metric?.trim() ? Number(metric) : NaN;
    if (!rest.length || !["keep", "discard", "crash"].includes(status) || (status !== "crash" && !Number.isFinite(v))) { skipped++; continue; }
    rows.push({ commit, metric: Number.isFinite(v) ? v : null, status, description: rest.join(" ") });
  }
  return { rows, skipped };
}

/** Where an experiment stands. frontier[i] is the best kept metric after row i; change is percent against the baseline. */
export function resultStats(rows, direction) {
  const better = (a, b) => (direction === "higher" ? a > b : a < b), count = (s) => rows.filter((r) => r.status === s).length;
  let best = null;
  const frontier = rows.map((r) => {
    if (r.status === "keep" && r.metric != null && (best == null || better(r.metric, best))) best = r.metric;
    return best;
  });
  const baseline = rows.find((r) => r.status === "keep" && r.metric != null)?.metric ?? null;
  return { baseline, best, change: baseline ? ((best - baseline) / Math.abs(baseline)) * 100 : null, kept: count("keep"), discarded: count("discard"), crashed: count("crash"), frontier };
}

/** The results chart: a dot per try (crashes on the floor) and the frontier as a stepped SVG path. */
export function chartGeom(rows, frontier, W = 800, H = 200, pad = 12) {
  const vals = rows.map((r) => r.metric).filter((v) => v != null), min = vals.length ? Math.min(...vals) : 0, span = (vals.length ? Math.max(...vals) : 0) - min || 1;
  const r1 = (v) => Math.round(v * 10) / 10;
  const x = (i) => r1(rows.length > 1 ? pad + (i / (rows.length - 1)) * (W - 2 * pad) : W / 2);
  const y = (v) => r1(v == null ? H - pad : H - pad - ((v - min) / span) * (H - 2 * pad));
  let path = "";
  frontier.forEach((f, i) => { if (f != null) path += path ? `H${x(i)}V${y(f)}` : `M${x(i)},${y(f)}`; });
  return { dots: rows.map((r, i) => ({ x: x(i), y: y(r.metric), status: r.status })), path };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib.js src/lib.test.js
git commit -m "Experiments: read results.tsv, stats and chart geometry"
```

---

### Task 2: The harness and the allowlist

**Files:**
- Modify: `src/lib.js` (append after Task 1's code)
- Test: `src/lib.test.js` (append)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces, where `Experiment = { files: string[], command: string, metric: string, direction: "lower" | "higher", budget: number }`:
  - `runSh(ex: Experiment, repo: string) → string`, the text of `run.sh`. `repo` is the name of the worktree's link inside the project folder.
  - `experimentSettings(ex: Experiment, repo: string, abs: string) → object`, the content of `.claude/settings.json`. `abs` is the worktree's absolute path.
  - `filesBad(files: string[]) → string` and `metricBad(re: string) → string`: an error message for the dialog, or `""` when fine.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib.test.js`:

```js
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
  assert.match(out("echo boom; exit 3"), /^crash: exit 3\nboom\n/, "a crash shows the end of the log");
  assert.equal(out("echo nothing here", "x=(\\d+)").split("\n")[0], "crash: no metric");
  assert.equal(out("sleep 5", "", 1).split("\n")[0], "crash: timeout");
  rmSync(d, { recursive: true });

  const s = experimentSettings({ files: ["src/*.rs"] }, "demo", "/w/demo@p");
  assert.deepEqual(s.permissions.additionalDirectories, ["/w/demo@p"]);
  assert.deepEqual(s.permissions.allow.slice(0, 4), ["Edit(demo/src/*.rs)", "Edit(//w/demo@p/src/*.rs)", "Edit(results.tsv)", "Bash(./run.sh)"]);
  assert.ok(s.permissions.allow.includes("Bash(git -C demo reset:*)") && !s.permissions.allow.some((r) => /push|Bash\(git:|Bash\(\*/.test(r)), "git is allowed per subcommand, and not push");

  assert.equal(filesBad(["src/a.rs", "lib/**"]), "");
  for (const f of [[], ["../other/**"], ["/etc/passwd"], ["src/../../x"], ["a(b)"]]) assert.ok(filesBad(f), JSON.stringify(f) + " is refused");
  assert.equal(metricBad(""), "");
  assert.equal(metricBad("time: (?:about )?([\\d.]+)"), "");
  for (const re of ["time: [\\d.]+", "(a)(b)", "(unclosed"]) assert.ok(metricBad(re), re + " is refused");
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test`
Expected: FAIL, `runSh is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib.js`:

```js
const sq = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
// the last number on a line; with `tail -n 1`, the last number printed
const LAST_NUMBER = String.raw`.*(?<![\w.-])(-?\d+(?:\.\d+)?)`;

/** run.sh for an experiment: runs the command in the repo (linked as `repo` beside the script) within the budget, keeps the
 * output in run.log and prints only `metric: <n>` or `crash: <why>` plus the log's end. Claude may run it, not edit it. */
export const runSh = (ex, repo) => `#!/bin/sh
# Written by Nimbus: this experiment's fixed harness. Do not edit.
cd "$(dirname "$0")" || exit 1
log="$PWD/run.log"
(cd ${sq(repo)} && timeout -k 5 ${Math.round(ex.budget)} sh -c ${sq(ex.command)}) > "$log" 2>&1
code=$?
crash() { echo "crash: $1"; tail -n 40 "$log"; exit 1; }
[ $code -eq 124 ] || [ $code -eq 137 ] && crash timeout
[ $code -ne 0 ] && crash "exit $code"
m=$(RE=${sq(ex.metric.trim() || LAST_NUMBER)} perl -ne 'print "$1\\n" if /$ENV{RE}/' "$log" | tail -n 1)
[ -n "$m" ] || crash "no metric"
echo "metric: $m"
`;

/** .claude/settings.json for an experiment: what Claude may do without asking, so the loop runs unattended. Everything else still prompts.
 * The worktree is a symlink out of the project folder, hence the rule by absolute path (//…) and additionalDirectories. */
export const experimentSettings = (ex, repo, abs) => ({
  permissions: {
    allow: [
      ...ex.files.flatMap((f) => [`Edit(${repo}/${f})`, `Edit(/${abs}/${f})`]),
      "Edit(results.tsv)",
      "Bash(./run.sh)",
      ...["status", "diff", "log", "show", "add", "commit", "reset"].map((sub) => `Bash(git -C ${repo} ${sub}:*)`),
    ],
    additionalDirectories: [abs],
  },
});

/** Why these editable files can't be used ("" when they can): they become permission rules, so they must stay inside the repo. */
export const filesBad = (files) =>
  !files.length ? "List at least one file Claude may edit"
    : files.some((f) => f.startsWith("/") || f.split("/").includes("..") || /[()]/.test(f)) ? "Files are paths inside the repo: no leading /, no .. and no brackets"
    : "";

/** Why this metric regex can't be used ("" when it can; empty means the last number printed). */
export const metricBad = (re) => {
  if (!re.trim()) return "";
  try { return new RegExp(re + "|").exec("").length === 2 ? "" : "Put exactly one ( ) group around the number"; } catch { return "Not a valid regex"; }
};
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm test`
Expected: all tests pass. The run takes about a second longer (the timeout case).

- [ ] **Step 5: Commit**

```bash
git add src/lib.js src/lib.test.js
git commit -m "Experiments: run.sh harness, permission allowlist, field checks"
```

---

### Task 3: The instructions Claude gets

**Files:**
- Modify: `src/lib.js` (append after Task 2's code)
- Test: `src/lib.test.js` (append)

**Interfaces:**
- Consumes: `projBranch(name)` (already in `src/lib.js`).
- Produces:
  - `experimentMd({ name: string, goal: string, repo: { id: string, remote?: string }, experiment: Experiment }) → string`. `repo.id` is the link name inside the project folder.
  - `EXPERIMENT_START: string`, `EXPERIMENT_RESUME: string`

- [ ] **Step 1: Write the failing test**

Append to `src/lib.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npm test`
Expected: FAIL, `experimentMd is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib.js`:

```js
/** First messages for an experiment's Claude: START when it is new, RESUME when coming back to it. */
export const EXPERIMENT_START = "Read CLAUDE.md, then start the experiment loop.";
export const EXPERIMENT_RESUME = "Read CLAUDE.md, results.tsv and the git log, then carry on with the experiment loop.";

/** CLAUDE.md for an experiment: karpathy/autoresearch's program.md for any command that prints a number. repo.id is its link in the folder. */
export function experimentMd({ name, goal, repo, experiment: ex }) {
  const r = repo.id, dir = ex.direction === "higher" ? "Higher" : "Lower", g = `git -C ${r}`;
  return `# Experiment: ${name}

This folder is an experiment in Nimbus. You improve one number by trial and error, on your own, until the user stops you.

- The repo is \`${r}/\`${repo.remote ? ` (github.com/${repo.remote})` : ""}, this experiment's own worktree on the branch \`${projBranch(name)}\`.
- You may edit only: ${ex.files.map((f) => `\`${r}/${f}\``).join(", ")}
- One run is \`./run.sh\`, from this folder. It runs the command below in the repo for at most ${ex.budget} seconds and prints \`metric: <number>\`, or \`crash: <why>\` and the end of the log. The full output is in \`run.log\`; read it only when you need to.
- **${dir} is better.**

\`\`\`
${ex.command}
\`\`\`

## Goal

${goal.trim() || "Get the best metric you can."}

## Rules

- Edit only the files listed above. Read anything you like.
- Never edit \`run.sh\`, and never change how the metric is produced or measured. A better number from a weaker measurement is not a result.
- Don't install packages or add dependencies.
- Simpler wins. A tiny gain that adds ugly code is not worth keeping. The same result from less code is.
- Use exactly these commands, which are allowed without asking. Anything else stops the loop until the user answers:
  - \`./run.sh\`
  - \`${g} status\`, \`${g} diff\`, \`${g} log\`, \`${g} show\`
  - \`${g} add <file>\`, \`${g} commit -am "<what you tried>"\`, \`${g} reset --hard <commit>\`
  - the Edit tool, on the files above and on \`results.tsv\`

## results.tsv

One row per run, tab-separated, appended with the Edit tool. Never rewrite earlier rows.

\`\`\`
commit	metric	status	description
a1b2c3d	0.9979	keep	baseline
b2c3d4e	0.9932	keep	raise the cache size to 4096
c3d4e5f	1.0050	discard	switch to a B-tree
d4e5f6a		crash	double the buffer (out of memory)
\`\`\`

- \`commit\`: the short hash of the commit you ran.
- \`metric\`: the number \`run.sh\` printed; empty for a crash.
- \`status\`: \`keep\`, \`discard\` or \`crash\`.
- \`description\`: one line on what you tried. No tabs.

## The loop

Repeat forever:

1. Read \`results.tsv\` and \`${g} log --oneline -20\`. That is your memory: your context gets compacted on a long run, these do not.
2. If \`results.tsv\` has no rows yet, change nothing: run, and record the result as \`baseline\` with status \`keep\`.
3. Otherwise make one change, and commit it.
4. Run \`./run.sh\`.
5. Append the row to \`results.tsv\`.
6. Better than the best \`keep\` so far: keep the commit. Equal or worse: \`${g} reset --hard <commit>\` to the newest \`keep\` row's commit.
7. A crash from something small (a typo, a missing import): fix it and run again. After a couple of tries, or when the idea itself is broken: record \`crash\` and reset the same way.

**Never stop to ask whether to continue.** The user may be asleep and expects you to keep going until they stop you. Out of ideas: re-read the files, combine near-misses, try something more radical, try removing things.
`;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib.js src/lib.test.js
git commit -m "Experiments: the CLAUDE.md that runs the loop"
```

---

### Task 4: Let the project folder take the new files

`save_project` refuses every file except `CLAUDE.md` and `.nimbus-project.json` (`src-tauri/src/lib.rs:912-917`). `saveProject` in `src/App.jsx:693` already passes `REPORT.html` and `REPORT.json`, so creating an HTML-report project looks broken today. The new test covers those two files as well.

**Files:**
- Modify: `src-tauri/src/lib.rs:890-920` (`PROJECT`, `save_project`) and the `tests` module at the end

**Interfaces:**
- Produces: the Tauri command `save_project(name, repos, files)` is unchanged in shape and now accepts these keys in `files`: `CLAUDE.md`, `.nimbus-project.json`, `REPORT.html`, `REPORT.json`, `run.sh`, `results.tsv`, `.claude/settings.json`. `run.sh` is written with mode 755.

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/lib.rs`, inside `mod tests`, add:

```rust
    #[test]
    fn project_files_are_a_fixed_list() {
        use std::os::unix::fs::PermissionsExt;
        let d = std::env::temp_dir().join(format!("nimbus-pfiles-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        let files = |pairs: &[(&str, &str)]| pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<HashMap<_, _>>();
        write_project_files(&d, &files(&[("run.sh", "#!/bin/sh\n"), (".claude/settings.json", "{}"), ("REPORT.html", "<p>"), ("REPORT.json", "{}"), ("results.tsv", "h\n")])).unwrap();
        assert_eq!(fs::metadata(d.join("run.sh")).unwrap().permissions().mode() & 0o777, 0o755, "run.sh can be run");
        assert_eq!(fs::read_to_string(d.join(".claude/settings.json")).unwrap(), "{}");
        assert!(d.join("REPORT.html").exists() && d.join("results.tsv").exists(), "an HTML-report project can be created");
        for bad in ["../escaped", "notes.md", ".claude/other.json", "run.sh/x"] {
            assert!(write_project_files(&d, &files(&[(bad, "x")])).is_err(), "{bad} is not a project file");
        }
        assert!(!d.parent().unwrap().join("escaped").exists());
        fs::remove_dir_all(&d).unwrap();
    }
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd src-tauri && cargo test project_files_are_a_fixed_list`
Expected: FAIL to compile, `cannot find function write_project_files`.

- [ ] **Step 3: Implement**

In `src-tauri/src/lib.rs`, below `pub(crate) const PROJECT`, add:

```rust
/// What Nimbus may write into a project folder: the files it generates itself. Anything else is refused.
const PROJECT_FILES: [&str; 7] = ["CLAUDE.md", PROJECT, "REPORT.html", "REPORT.json", "run.sh", "results.tsv", ".claude/settings.json"];

fn write_project_files(d: &Path, files: &HashMap<String, String>) -> Result<(), String> {
    for (f, text) in files {
        if !PROJECT_FILES.contains(&f.as_str()) {
            return Err(format!("not a project file: {f}"));
        }
        let p = d.join(f);
        if let Some(up) = p.parent() {
            fs::create_dir_all(up).map_err(|e| e.to_string())?;
        }
        fs::write(&p, text).map_err(|e| e.to_string())?;
        if f == "run.sh" {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&p, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
```

In `save_project`, replace the loop

```rust
    for (f, text) in &files {
        if f != "CLAUDE.md" && f != PROJECT {
            return Err(format!("not a project file: {f}"));
        }
        fs::write(d.join(f), text).map_err(|e| e.to_string())?;
    }
```

with

```rust
    write_project_files(&d, &files)?;
```

and update the doc comment above `save_project` so its second line reads:

```rust
/// `files` (see PROJECT_FILES: CLAUDE.md, the .nimbus-project.json it is recognised by, …) and takes the project and its repos out of reserve.
```

- [ ] **Step 4: Run the Rust tests**

Run: `cd src-tauri && cargo test`
Expected: all pass, including `project_files_are_a_fixed_list`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "Projects: the folder takes REPORT.html, run.sh and the other generated files"
```

---

### Task 5: Starting an experiment

**Files:**
- Modify: `src/Overlays.jsx:1-4` (imports) and `NewProject` (`src/Overlays.jsx:310-385`)
- Modify: `src/App.jsx:21` (imports), `saveProject` (`src/App.jsx:677-700`), `claudeIn` (`src/App.jsx:751`), the confirmation in `deleteProject` (`src/App.jsx:734`)

**Interfaces:**
- Consumes: `filesBad`, `metricBad`, `EXPERIMENT_START`, `EXPERIMENT_RESUME`, `experimentMd`, `runSh`, `experimentSettings`, `RESULTS_HEADER` from `src/lib.js` (Tasks 1 to 3); `save_project` accepting the new files (Task 4).
- Produces: a project folder whose `.nimbus-project.json` is `{ kind: "experiment", goal, repos: [<repo>@<project>], experiment: Experiment }`. Task 6 reads `cfg.kind` and `cfg.experiment.direction`.

There is no component test setup in this repo (tests are `node --test` on `src/lib.js` only), so this task is verified by the build and by hand. All its logic is in functions Tasks 1 to 3 already test.

- [ ] **Step 1: The dialog's state and checks**

In `src/Overlays.jsx`, change the `lib.js` import to:

```js
import { ago, fuzzy, START, KICKOFF, EXPERIMENT_START, projTree, filesBad, metricBad } from "./lib.js";
```

In `NewProject`, after the `const [busy, setBusy] = useState(false);` line, add:

```js
  // an experiment: one repo, and Claude loops on a metric instead of going through the phases
  const [mode, setMode] = useState("phases");
  const [exFiles, setExFiles] = useState(""), [command, setCommand] = useState(""), [metric, setMetric] = useState("");
  const [direction, setDirection] = useState("lower"), [minutes, setMinutes] = useState("5");
  const ex = !edit && mode === "experiment";
  const experiment = { files: exFiles.split("\n").map((s) => s.trim()).filter(Boolean), command: command.trim(), metric: metric.trim(), direction, budget: Math.round(Number(minutes) * 60) };
  const exBad = ex && (pick.length !== 1 ? "Pick the one repo to experiment in" : filesBad(experiment.files) || (!experiment.command && "Enter the command to run") || metricBad(experiment.metric) || (!(experiment.budget >= 1) && "The budget is a number of minutes"));
  const pickMode = (m) => { setMode(m); setMsg(m === "experiment" ? EXPERIMENT_START : START); if (m === "experiment") setPick((p) => p.slice(0, 1)); };
```

Replace the body of `go` so an experiment sends its settings instead of a report:

```js
  const go = async (claude) => {
    setBusy(true);
    const picked = choices.filter((x) => pick.includes(x.id));
    await saveProject({ name: name.trim(), goal, repos: picked, ...(ex ? { experiment } : { report: kind === "issue" && on ? { kind, repo: on, issue: issue.replace(/\D/g, "") } : { kind: "html" } }) }, claude && msg);
    setBusy(false);
  };
```

- [ ] **Step 2: The dialog's fields**

Still in `NewProject`'s JSX. Directly above the project-name `<input autoFocus …>` line, add the switch:

```jsx
        {!edit && seg([["Phases", mode === "phases", () => pickMode("phases")], ["Experiment", mode === "experiment", () => pickMode("experiment")]])}
        {ex && <div style={{ fontSize: 12, color: "var(--dim)", lineHeight: 1.5, marginTop: -4 }}>Claude loops on its own: change the code, run your command, keep the commit if the number improved, undo it if not. Leave it running and come back to a table of what it tried.</div>}
```

Change the goal placeholder so it fits both kinds:

```jsx
placeholder={ex ? "Goal: what to improve and any ideas to try (optional)" : "Goal: what done looks like (Claude asks if you leave it empty)"}
```

Change the label above the repo list from `<div className="label">Repos</div>` to:

```jsx
        <div className="label">{ex ? "Repo" : "Repos"}</div>
```

In the repo row's `onClick`, make an experiment pick exactly one. Replace

```jsx
onClick={() => fixed || setPick((p) => (in_ ? p.filter((y) => y !== x.id) : [...p, x.id]))}
```

with

```jsx
onClick={() => fixed || setPick((p) => (ex ? [x.id] : in_ ? p.filter((y) => y !== x.id) : [...p, x.id]))}
```

Change the reporting block's guard from `{!edit && <>` to `{!edit && !ex && <>` (the block that starts with `<div className="label">Claude reports back on</div>`).

Directly after that block's closing `</>}`, add the experiment's fields:

```jsx
        {ex && <>
          <div className="label">Files Claude may edit</div>
          <textarea className="mono" value={exFiles} onChange={(e) => setExFiles(e.target.value)} placeholder={"One per line, inside the repo:\nsrc/parse.rs\nsrc/lex/*.rs"} rows={3}
            style={{ ...field, height: "auto", resize: "none", padding: "8px 10px", lineHeight: "18px", marginTop: -4 }} />
          <div className="label">Run</div>
          <input className="mono" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Command that prints the number, e.g. cargo bench parse" style={{ ...field, marginTop: -4 }} />
          <input className="mono" value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="Metric regex with one ( ) group, e.g. time:\s+([\d.]+)   (empty: the last number printed)" style={field} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: "var(--soft)" }}>
            {seg([["Lower is better", direction === "lower", () => setDirection("lower")], ["Higher is better", direction === "higher", () => setDirection("higher")]])}
            <span className="spacer" />
            <span>Stop a run after</span>
            <input className="mono" value={minutes} onChange={(e) => setMinutes(e.target.value)} style={{ ...field, width: 56, textAlign: "right" }} />
            <span>min</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--dim)", lineHeight: 1.5 }}>Claude may edit those files, run this command and commit or reset in the repo without asking. Anything else still asks you first, and the loop waits until you answer.</div>
          {exBad && <div style={{ fontSize: 11.5, color: "var(--dim)" }}>{exBad}</div>}
        </>}
```

Replace the `disabled` expression on both the "Create and start Claude" and the "Create" buttons. It is

```jsx
disabled={busy || !!bad || !pick.length || (!edit && kind === "issue" && !on)}
```

and becomes

```jsx
disabled={busy || !!bad || !pick.length || !!exBad || (!edit && !ex && kind === "issue" && !on)}
```

- [ ] **Step 3: Writing the experiment's files**

In `src/App.jsx`, add to the `./lib.js` import on line 21: `experimentMd, runSh, experimentSettings, RESULTS_HEADER, EXPERIMENT_RESUME`.

In `saveProject`, replace these four lines

```js
      const md = proj.edit ? withRepos(await invoke("read_file", { id, path: "CLAUDE.md" }), listed) : projectMd(p);
      const cfg = proj.edit ? { ...proj.init, repos: ids } : { goal: p.goal, report: p.report, repos: ids, phase: "start" };
      const files = { "CLAUDE.md": md, ".nimbus-project.json": JSON.stringify(cfg, null, 2) + "\n" };
      if (!proj.edit && p.report.kind === "html") Object.assign(files, { "REPORT.html": REPORT_HTML, "REPORT.json": JSON.stringify(reportSeed(p), null, 2) + "\n" });
```

with

```js
      // an experiment: one repo, with a harness, a results log and an allowlist instead of phases and a report
      const ex = !proj.edit && p.experiment, link = listed[0]?.id;
      const md = proj.edit ? withRepos(await invoke("read_file", { id, path: "CLAUDE.md" }), listed) : ex ? experimentMd({ name: id, goal: p.goal, repo: listed[0], experiment: ex }) : projectMd(p);
      const cfg = proj.edit ? { ...proj.init, repos: ids } : ex ? { kind: "experiment", goal: p.goal, repos: ids, experiment: ex } : { goal: p.goal, report: p.report, repos: ids, phase: "start" };
      const files = { "CLAUDE.md": md, ".nimbus-project.json": JSON.stringify(cfg, null, 2) + "\n" };
      if (ex) Object.assign(files, { "run.sh": runSh(ex, link), "results.tsv": RESULTS_HEADER, ".claude/settings.json": JSON.stringify(experimentSettings(ex, link, wf.abs + "/" + ids[0]), null, 2) + "\n" });
      else if (!proj.edit && p.report.kind === "html") Object.assign(files, { "REPORT.html": REPORT_HTML, "REPORT.json": JSON.stringify(reportSeed(p), null, 2) + "\n" });
```

- [ ] **Step 4: Resuming an experiment**

In `src/App.jsx`, replace `claudeIn`:

```js
  const claudeIn = (id, first = KICKOFF) => setAsking({ title: `Start Claude in ${id}`, placeholder: "First message (empty: none)", value: first, okLabel: "Start", ok: (m) => newTerm(claudeCmd(m, mcpExe), id) });
```

with

```js
  // no first message given: the project's own, which for an experiment is to pick the loop back up
  const claudeIn = async (id, first) => {
    first ??= await invoke("read_file", { id, path: ".nimbus-project.json" }).then((t) => (JSON.parse(t).kind === "experiment" ? EXPERIMENT_RESUME : KICKOFF), () => KICKOFF);
    setAsking({ title: `Start Claude in ${id}`, placeholder: "First message (empty: none)", value: first, okLabel: "Start", ok: (m) => newTerm(claudeCmd(m, mcpExe), id) });
  };
```

The call on `src/App.jsx:650` passes `""` and keeps doing so.

In `deleteProject`, the confirmation says "Its folder, CLAUDE.md and REPORT.html go". Change `CLAUDE.md and REPORT.html` to `CLAUDE.md and its report or results` so it is true of both kinds.

- [ ] **Step 5: Build, then try it**

Run: `npm test && npm run build`
Expected: tests pass and the build finishes with no errors.

Run: `npm run tauri dev`, then in the app:
1. Start a project → the Phases / Experiment switch is there; Phases looks and works as before, and creating an HTML-report project now succeeds.
2. Switch to Experiment: repo list picks one at a time; Create stays disabled, with the reason shown, until a repo, a file, a command and a valid regex are in. Try `../x` as a file and `time: [\d.]+` as the regex: both are refused.
3. Create one with "Create" (no Claude). In `~/work/<name>/` check: `run.sh` is executable, `.claude/settings.json` lists the rules, `results.tsv` has the header, `.nimbus-project.json` has `kind: "experiment"`.
4. Run `./run.sh` in that folder by hand: it prints `metric: …`.
5. Project page → Start Claude: the first message offered is the resume one.

- [ ] **Step 6: Commit**

```bash
git add src/Overlays.jsx src/App.jsx
git commit -m "Experiments: start one from the project dialog"
```

---

### Task 6: Seeing the results

**Files:**
- Create: `src/Experiment.jsx`
- Modify: `src/Main.jsx:5-6` (imports), `ProjectTab` (`src/Main.jsx:279-340`), `ProjectHome` (`src/Main.jsx:342-432`)
- Modify: `README.md` (one paragraph)

**Interfaces:**
- Consumes: `parseResults`, `resultStats`, `chartGeom` (Task 1); `cfg.kind`, `cfg.experiment.direction` (Task 5); the Tauri command `read_file({ id, path })`.
- Produces: `Experiment({ id, cfg, n })`, a component. `n` is the project page's refresh counter.

- [ ] **Step 1: The component**

Create `src/Experiment.jsx`:

```jsx
// An experiment project's results: where it stands, a chart of every try, and the log (results.tsv in the project folder).
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { I } from "./ui.jsx";
import { parseResults, resultStats, chartGeom } from "./lib.js";

const COLOR = { keep: "var(--add)", discard: "var(--dim)", crash: "var(--del)" };
const num = (v) => (v == null ? "" : String(+v.toPrecision(6)));

export function Experiment({ id, cfg, n }) {
  const [tsv, setTsv] = useState(null);
  useEffect(() => {
    let dead = false;
    invoke("read_file", { id, path: "results.tsv" }).then((t) => !dead && setTsv(t), () => !dead && setTsv(""));
    return () => { dead = true; };
  }, [id, n]);
  if (tsv == null) return <div style={{ color: "var(--dim)", display: "flex", gap: 8, alignItems: "center" }}><I n="ph-circle-notch spin" />Loading…</div>;
  const { rows, skipped } = parseResults(tsv), dir = cfg.experiment?.direction;
  if (!rows.length) return <div style={{ color: "var(--dim)" }}>No results yet: Claude records the baseline after its first run.{skipped > 0 && ` (${skipped} unreadable row${skipped > 1 ? "s" : ""} in results.tsv)`}</div>;
  const s = resultStats(rows, dir), { dots, path } = chartGeom(rows, s.frontier);
  const good = s.change != null && s.change !== 0 && (dir === "higher" ? s.change > 0 : s.change < 0);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", fontSize: 12.5, color: "var(--dim)" }}>
        <span className="mono" style={{ fontSize: 22, color: "var(--fg)" }}>{s.best == null ? "no kept run yet" : num(s.best)}</span>
        {s.change != null && s.change !== 0 && <span style={{ color: good ? "var(--add)" : "var(--del)" }}>{s.change > 0 ? "+" : ""}{s.change.toFixed(2)}% vs baseline {num(s.baseline)}</span>}
        <span className="spacer" />
        <span>{rows.length} run{rows.length > 1 ? "s" : ""}</span>
        <span style={{ color: COLOR.keep }}>{s.kept} kept</span>
        <span>{s.discarded} discarded</span>
        <span style={{ color: s.crashed ? COLOR.crash : undefined }}>{s.crashed} crashed</span>
        {skipped > 0 && <span title="Rows in results.tsv that aren't commit, metric, status, description">{skipped} unreadable</span>}
      </div>
      <svg viewBox="0 0 800 200" role="img" aria-label={`Metric per run, ${dir} is better`} style={{ display: "block", width: "100%", marginTop: 12, borderRadius: 10, boxShadow: "0 0 0 1px var(--border)" }}>
        <path d={path} fill="none" stroke={COLOR.keep} strokeWidth="1.5" />
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={d.status === "keep" ? 4 : 3} fill={d.status === "discard" ? "none" : COLOR[d.status]} stroke={COLOR[d.status]} strokeWidth="1.2">
            <title>{`${rows[i].commit} · ${rows[i].status}${rows[i].metric == null ? "" : " · " + num(rows[i].metric)}\n${rows[i].description}`}</title>
          </circle>
        ))}
      </svg>
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "auto auto auto 1fr", columnGap: 16, rowGap: 6, fontSize: 12.5, alignItems: "baseline" }}>
        {rows.map((r, i) => [
          <span key={i + "c"} className="mono" style={{ fontSize: 11.5, color: "var(--dimmer)" }}>{r.commit}</span>,
          <span key={i + "m"} className="mono" style={{ textAlign: "right", color: "var(--soft)" }}>{num(r.metric)}</span>,
          <span key={i + "s"} style={{ color: COLOR[r.status] }}>{r.status}</span>,
          <span key={i + "d"} style={{ color: r.status === "keep" ? "var(--soft)" : "var(--dim)" }}>{r.description}</span>,
        ]).reverse()}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Show it on the project page**

In `src/Main.jsx`, add the import below the `./lib.js` import:

```js
import { Experiment } from "./Experiment.jsx";
```

In `ProjectTab`, directly above the line `if (tab === DIFF) return <ProjectDiff repos={repos} n={n} height={height} />;`, add:

```jsx
  // ponytail: the report effect above still looks for a REPORT.html an experiment doesn't have; a miss is cheap. Skip it there if that read ever matters
  if (!tab && cfg.kind === "experiment") return <Experiment id={id} cfg={cfg} n={n} />;
```

It must stay below every hook in `ProjectTab` (React's rule: no return before a hook). This also covers the popped-out window, which renders `ProjectTab` from `src/ProjectWindow.jsx`.

In `ProjectHome`:

- After `const mine = …, rp = cfg?.report || {};` add:

```js
  const exp = cfg?.kind === "experiment";
```

- Change the `where` line to:

```js
  const where = exp ? "results.tsv" : rp.kind === "issue" ? `${rp.repo}${rp.issue ? "#" + rp.issue : ""}` : "REPORT.html";
```

- Hide the phase stepper: change `{cfg && <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", fontSize: 12.5 }}>` to start with `{cfg && !exp && <div`.

- Show what is being run instead. Directly after the stepper block's closing `</div>}`, add:

```jsx
        {exp && <div className="mono" style={{ marginTop: 14, fontSize: 12, color: "var(--dim)" }}>{cfg.experiment.command} · {cfg.experiment.direction} is better · {Math.round(cfg.experiment.budget / 60)} min per run</div>}
```

- An experiment has one repo: change `<button className="ghost" onClick={addRepos}><I n="ph-plus" />Add repos</button>` to `{!exp && <button className="ghost" onClick={addRepos}><I n="ph-plus" />Add repos</button>}`.

- Name the first tab: in the tab strip, change the label expression `f === DIFF ? "Diff" : f ? f.replace(/\.html?$/i, "") : "Report"` to `f === DIFF ? "Diff" : f ? f.replace(/\.html?$/i, "") : exp ? "Results" : "Report"`.

- [ ] **Step 3: Say it exists**

In `README.md`, after the **Projects** paragraph near the top, add:

```markdown
**Experiments** are projects where Claude loops on one number, after [karpathy/autoresearch](https://github.com/karpathy/autoresearch): you name a repo, the files it may edit, a command and how to read a metric from its output. Claude changes the code, runs it, keeps the commit when the number improves and undoes it when it doesn't, and the project page charts every try. It may edit those files, run that command and commit or reset in that repo without asking; anything else still asks you.
```

- [ ] **Step 4: Build, then try it**

Run: `npm test && npm run build`
Expected: tests pass, build finishes with no errors.

Run: `npm run tauri dev`. Open the experiment made in Task 5. Its page shows the command line, no phase stepper, a "Results" tab saying no results yet. Then put rows in its `results.tsv` by hand:

```
commit	metric	status	description
a1b2c3d	10	keep	baseline
b2c3d4e	12	discard	wider
c3d4e5f		crash	OOM
d4e5f6a	8	keep	smaller
not a row
```

Within 10 s (or on Refresh) the page shows `8`, `-20.00% vs baseline 10` in the good colour for a lower-is-better experiment, `4 runs · 2 kept · 1 discarded · 1 crashed · 1 unreadable`, four dots with a stepped line, and the table newest first. Pop the tab out: the same view. A phase project's page is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/Experiment.jsx src/Main.jsx README.md
git commit -m "Experiments: results chart and table on the project page"
```

---

### Task 7: One real run

The allowlist's rule syntax is the one part no test here can prove: whether Claude Code matches `Edit(<repo>/<glob>)` through the symlinked worktree, and `Bash(git -C <repo> commit:*)` against what Claude actually types. This task finds out.

**Files:**
- Possibly modify: `src/lib.js` (`experimentSettings`, `experimentMd`) and their tests, only if a prompt appears that the allowlist was meant to cover.

- [ ] **Step 1: A throwaway repo with a real metric**

```bash
mkdir -p ~/work/exp-demo && cd ~/work/exp-demo && git init -q -b main
printf 'import time\ndef work():\n    return sum(i * i for i in range(2_000_000))\nt = time.perf_counter(); work(); print(f"seconds: {time.perf_counter() - t:.4f}")\n' > bench.py
git add . && git -c user.name=t -c user.email=t@t commit -qm bench
```

- [ ] **Step 2: Run an experiment on it**

In `npm run tauri dev`: Start a project → Experiment. Repo `exp-demo`, file `bench.py`, command `python3 bench.py`, regex `seconds: ([\d.]+)`, lower is better, 1 min. Create and start Claude.

Watch for five iterations. Expected: no permission prompt for editing `bench.py`, appending to `results.tsv`, `./run.sh`, or the `git -C exp-demo …` commands; the sidebar shows *working* throughout; the Results tab fills in.

- [ ] **Step 3: If something prompts that shouldn't**

Note the exact tool call in the prompt, add or correct the matching rule in `experimentSettings` (and the command form in `experimentMd`, so they agree), update the expectations in `src/lib.test.js`, run `npm test`, and repeat Step 2 with a fresh project. Something outside the list prompting (say `pip install`) is correct and needs no change.

- [ ] **Step 4: Clean up and commit any fix**

Delete the project from its page (its worktree goes with it), then `rm -rf ~/work/exp-demo`.

```bash
git add src/lib.js src/lib.test.js
git commit -m "Experiments: allowlist rules as Claude Code matches them"
```

Skip the commit when Step 3 changed nothing.
