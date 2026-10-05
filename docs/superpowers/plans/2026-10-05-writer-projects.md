# Writer Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A third kind of project, for writing prose, whose project page shows the text as tracked changes (word-level), against main or one commit at a time.

**Architecture:** `kind: "writer"` in `.nimbus-project.json`, handled next to `kind: "experiment"` everywhere that is special-cased. Word-level changes come from `git diff --word-diff=porcelain` through the existing `git` command; one pure parser in `src/lib.js` turns that into lines of runs, and a new `src/Writer.jsx` renders them. No Rust change, no new dependency.

**Tech Stack:** React 19 (JSX, inline styles, one-line CSS rules in `src/styles.css`), Tauri `invoke`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-05-writer-projects-design.md`

## Global Constraints

- No new npm or cargo dependencies.
- No change under `src-tauri/`.
- Prose files are exactly: `*.md`, `*.mdx`, `*.markdown`, `*.txt`, `*.rst`, `*.adoc`, `*.tex`.
- The view is read-only and shows source text, not rendered Markdown.
- A writer project has no `phase`, no `report`, no `REPORT.html`.
- Tests run with `npm test` (`node --test src/lib.test.js`). Only `src/lib.js` is unit-tested; JSX is checked by `npm run build` and by hand.
- Match the surrounding code: dense one-line statements, `/** */` on exports, UI copy in plain sentences without em dashes.
- Commit after each task, on a branch (not `main`).

## Review Focus

1. A file name with non-ASCII letters (`læring.md`): git octal-escapes it by default and `splitDiff` would lose the path. Expect it listed under its real name. Pinned by `-c core.quotePath=false` in Task 3 and the manual check there.
2. A text line that itself starts with `+`, `-` or `~` (a Markdown list `- item`, a diff quoted in the text): expect it shown verbatim, not eaten as a marker. Test in Task 1.
3. A prose file git does not track yet: `git diff` skips it. Expect it listed and shown as all inserted. `allAdded` test in Task 1, manual check in Task 3.
4. A prose file deleted on the branch: expect it listed struck through with its text shown as removed, not a crash. Test in Task 1 (all-removed input), manual check in Task 3.
5. A project repo with no `main` to compare with, or in reserve: expect a line saying so in place, the other repos still shown. Manual check in Task 3.

---

### Task 1: Word-diff parser and prose file list

**Files:**
- Modify: `src/lib.js` (append after the experiments section, at the end of the file)
- Test: `src/lib.test.js` (append)

**Interfaces:**
- Produces:
  - `PROSE: string[]` — the git pathspecs.
  - `PROSE_RE: RegExp` — matches a prose path.
  - `parseWordDiff(text: string): { lines: {t: " "|"+"|"-", s: string}[][], added: number, removed: number }`
  - `allAdded(text: string): { lines, added, removed }` — a whole file as inserted.

Background: `git diff --word-diff=porcelain` prints, after the `@@` line, one run per line. The first character is the marker: space (unchanged), `+` (inserted), `-` (removed). A line that is only `~` means a newline in the source. An empty source line comes out as a lone space followed by `~`. Real output:

```
@@ -1,6 +1,8 @@
 # Install
~
 
~
 Run the installer 
-script, which will set
+and it sets
  up the 
-application.
+app.
~
```

- [ ] **Step 1: Write the failing tests**

Append to `src/lib.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test`
Expected: FAIL in "writer: git's porcelain word diff becomes lines of runs" with `parseWordDiff is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib.js`:

```js
// ---- writer projects: a project whose work is a text to be read (see docs/superpowers/specs/2026-10-05-writer-projects-design.md) ----

/** The files a writer project's text view covers, as git pathspecs (a * there crosses folders), and the same as a test on a path. */
const PROSE_EXT = ["md", "mdx", "markdown", "txt", "rst", "adoc", "tex"];
export const PROSE = PROSE_EXT.map((e) => "*." + e);
export const PROSE_RE = new RegExp("\\.(" + PROSE_EXT.join("|") + ")$", "i");

const words = (s) => s.split(/\s+/).filter(Boolean).length;

/** One file's part of `git diff --word-diff=porcelain` -> the text as source lines, each a list of runs
 * { t: " " unchanged | "+" inserted | "-" removed, s }, with the words inserted and removed.
 * After the @@ line git prints one run per line, marker first, and a lone ~ for each newline in the source. */
export function parseWordDiff(text) {
  const lines = [[]];
  let added = 0, removed = 0, on = false;
  for (const l of text.split("\n")) {
    if (l.startsWith("@@")) { on = true; continue; }
    if (!on || !l || l[0] === "\\") continue;
    if (l === "~") { lines.push([]); continue; }
    const t = l[0], s = l.slice(1);
    if (!s) continue; // an empty source line: a lone space before its ~
    if (t === "+") added += words(s); else if (t === "-") removed += words(s);
    lines.at(-1).push({ t, s });
  }
  if (!lines.at(-1).length) lines.pop();
  return { lines, added, removed };
}

/** A file git doesn't track yet, in parseWordDiff's shape: every line inserted. */
export function allAdded(text) {
  const lines = text.split("\n").map((s) => (s ? [{ t: "+", s }] : []));
  if (!lines.at(-1).length) lines.pop();
  return { lines, added: words(text), removed: 0 };
}
```

Note on `@@`: a later source line starting with `@@` arrives as ` @@…` (marker first), so the `startsWith("@@")` check only ever matches git's own hunk header.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm test`
Expected: all tests pass, including the new one.

- [ ] **Step 5: Commit**

```bash
git add src/lib.js src/lib.test.js
git commit -m "Writer projects: parse git's word diff into lines of runs"
```

---

### Task 2: The project kind — CLAUDE.md, dialog, saving, resuming

**Files:**
- Modify: `src/lib.js` (append after Task 1's code)
- Test: `src/lib.test.js` (append)
- Modify: `src/Overlays.jsx` (`NewProject`, around lines 310-400)
- Modify: `src/App.jsx` (import on line 21, `saveProject` around 679-703, `claudeIn` around 757-760)

**Interfaces:**
- Consumes: `projectRepos`, `projBranch`, `withRepos` (already in `src/lib.js`).
- Produces:
  - `writerMd({ name, goal, repos }): string` — `repos` is `[{ id, remote }]`, as `projectMd` takes.
  - `WRITER_START: string`, `WRITER_RESUME: string`.
  - `.nimbus-project.json` of a writer project: `{ "kind": "writer", "goal": string, "repos": string[] }`. Task 3 reads `cfg.kind === "writer"`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to see it fail**

Run: `npm test`
Expected: FAIL with `writerMd is not a function`.

- [ ] **Step 3: Implement `writerMd` and the first messages**

Append to `src/lib.js`:

```js
/** First messages for a writer project's Claude: START when it is new, RESUME when coming back to it. */
export const WRITER_START = "Read CLAUDE.md and the texts in the repos, then ask me what is unclear about the text and its reader before you write.";
export const WRITER_RESUME = "Read CLAUDE.md and the git log of the repos, then tell me where the text stands and what you would revise next.";

/** CLAUDE.md for a writer project: the work is a text meant to be read. repos: [{ id, remote }], as for projectMd. */
export function writerMd({ name, goal, repos }) {
  return `# Writing: ${name}

This folder is a writing project in Nimbus. The work is a text meant to be read: documentation, a guide, an article. The repos it covers are linked inside it, each as this project's own worktree on the branch \`${projBranch(name)}\` (made from main). Each is its own git repo; commit per repo:

${projectRepos(repos)}

## Goal

${goal.trim() || "(not written yet: ask the user what the text is and who reads it, then fill it in here)"}

## Focus

- The work is the text. Write for the reader the goal names: what they already know, what they came to find out, what they do next.
- Change code when the text needs it (a docs build, an example that has to run, a link checker), and say so when you do. Don't go looking for code to improve.
- Ask before changing what the text claims. Tightening a sentence is yours to do; changing a fact is the user's call.

## Revisions

Nimbus shows the user how the text changed, word by word: everything against main, and one commit at a time. So:

- Commit each revision on its own, in the repo it belongs to. One commit is one step a reader can follow: a section drafted, a section tightened, a reordering.
- Say in the commit message what changed in the writing ("Tighten the install section", "Reorder: prerequisites first"), not "update docs".
- Keep a pure move (a paragraph to another place, nothing reworded) in its own commit: it shows as removed in one place and inserted in another, and is hard to read mixed with other edits.
- Don't re-wrap paragraphs you aren't changing.

## Reporting back

This project has no report page of its own. When Nimbus started you, you have its \`nimbus\` tools: keep the workfolder report current with \`set_report\` (what you are writing, the sections as tasks, open questions for the user, what you decided and why) and your status with \`set_status\`, use \`notify\` when you need the user, \`open_file\` to put a text in front of them, and \`add_repo\` (with \`project\`) when the work reaches a repo that isn't in the project yet.
`;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: The dialog (`src/Overlays.jsx`, `NewProject`)**

Add `WRITER_START, WRITER_RESUME` to the file's existing import from `./lib.js` (the one that already brings `EXPERIMENT_START`, `KICKOFF`, `START`).

Replace the `msg` state line:

```js
  const [msg, setMsg] = useState(edit ? KICKOFF : START);
```

with:

```js
  const [msg, setMsg] = useState(edit ? (proj.init?.kind === "writer" ? WRITER_RESUME : KICKOFF) : START);
```

Replace:

```js
  const ex = !edit && mode === "experiment";
```

with:

```js
  // a writing project: the work is a text, shown as tracked changes instead of a report
  const ex = !edit && mode === "experiment", wr = !edit && mode === "writer";
```

Replace the `pickMode` line with:

```js
  const pickMode = (m) => { setMode(m); setMsg(m === "experiment" ? EXPERIMENT_START : m === "writer" ? WRITER_START : START); if (m === "experiment") setPick((p) => p.slice(0, 1)); };
```

In `go`, replace the `saveProject` call with:

```js
    await saveProject({ name: name.trim(), goal, repos: picked, ...(ex ? { experiment } : wr ? { writer: true } : { report: kind === "issue" && on ? { kind, repo: on, issue: issue.replace(/\D/g, "") } : { kind: "html" } }) }, claude && msg);
```

Replace the mode switch and the experiment hint:

```jsx
        {!edit && seg([["Phases", mode === "phases", () => pickMode("phases")], ["Experiment", mode === "experiment", () => pickMode("experiment")]])}
```

with:

```jsx
        {!edit && seg([["Phases", mode === "phases", () => pickMode("phases")], ["Experiment", mode === "experiment", () => pickMode("experiment")], ["Writing", mode === "writer", () => pickMode("writer")]])}
        {wr && <div style={{ fontSize: 12, color: "var(--dim)", lineHeight: 1.5, marginTop: -4 }}>For a text meant to be read: documentation, a guide, an article. The project page shows how the text changed word by word, against main and one commit at a time. Claude may still change code when the text needs it.</div>}
```

Replace the goal placeholder expression:

```jsx
placeholder={ex ? "Goal: what to improve and any ideas to try (optional)" : "Goal: what done looks like (Claude asks if you leave it empty)"}
```

with:

```jsx
placeholder={ex ? "Goal: what to improve and any ideas to try (optional)" : wr ? "Goal: what the text is and who reads it (Claude asks if you leave it empty)" : "Goal: what done looks like (Claude asks if you leave it empty)"}
```

Hide the report choice for a writer project: change `{!edit && !ex && <>` (the block that starts with the "Claude reports back on" label) to `{!edit && !ex && !wr && <>`.

In both bottom buttons, change the `disabled` expression's last clause from `(!edit && !ex && kind === "issue" && !on)` to `(!edit && !ex && !wr && kind === "issue" && !on)`.

- [ ] **Step 6: Saving and resuming (`src/App.jsx`)**

Add `writerMd, WRITER_RESUME` to the `./lib.js` import on line 21.

In `saveProject`, replace these three lines:

```js
      const ex = !proj.edit && p.experiment, link = listed[0]?.id;
      const md = proj.edit ? withRepos(await invoke("read_file", { id, path: "CLAUDE.md" }), listed) : ex ? experimentMd({ name: id, goal: p.goal, repo: listed[0], experiment: ex }) : projectMd(p);
      const cfg = proj.edit ? { ...proj.init, repos: ids } : ex ? { kind: "experiment", goal: p.goal, repos: ids, experiment: ex } : { goal: p.goal, report: p.report, repos: ids, phase: "start" };
```

with:

```js
      // a writer project: only the CLAUDE.md and the project file, its page shows the text itself
      const ex = !proj.edit && p.experiment, wr = !proj.edit && p.writer, link = listed[0]?.id;
      const md = proj.edit ? withRepos(await invoke("read_file", { id, path: "CLAUDE.md" }), listed) : ex ? experimentMd({ name: id, goal: p.goal, repo: listed[0], experiment: ex }) : wr ? writerMd(p) : projectMd(p);
      const cfg = proj.edit ? { ...proj.init, repos: ids } : ex ? { kind: "experiment", goal: p.goal, repos: ids, experiment: ex } : wr ? { kind: "writer", goal: p.goal, repos: ids } : { goal: p.goal, report: p.report, repos: ids, phase: "start" };
```

Two lines below, change:

```js
      else if (!proj.edit && p.report.kind === "html") Object.assign(files, {
```

to:

```js
      else if (!proj.edit && !wr && p.report.kind === "html") Object.assign(files, {
```

(`p.report` is undefined for a writer project, so this guard is what keeps the line from throwing.)

In `claudeIn`, replace:

```js
value: first ?? (exp ? EXPERIMENT_RESUME : KICKOFF)
```

with:

```js
value: first ?? (exp ? EXPERIMENT_RESUME : cfg.kind === "writer" ? WRITER_RESUME : KICKOFF)
```

- [ ] **Step 7: Check it builds and the tests still pass**

Run: `npm test && npm run build`
Expected: tests pass; vite builds without errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib.js src/lib.test.js src/Overlays.jsx src/App.jsx
git commit -m "Writer projects: start one from the project dialog"
```

---

### Task 3: The text view

**Files:**
- Create: `src/Writer.jsx`
- Modify: `src/ui.jsx` (add `mergeBase` after `mainOf`, line 23)
- Modify: `src/Main.jsx` (imports lines 5-7; `ProjectDiff` line 210-211; `popOut` ~276; `ProjectTab` line 328; `ProjectHome` ~368-425)
- Modify: `src/ProjectWindow.jsx` (lines 14 and 19)
- Modify: `src/styles.css` (append)

**Interfaces:**
- Consumes: `parseWordDiff`, `allAdded`, `PROSE`, `PROSE_RE`, `splitDiff` from `src/lib.js`; `git`, `mainOf`, `seg`, `I` from `src/ui.jsx`; a repo object `x` with `id`, `git`, `branch`, `changes: [{ path, status }]` (an untracked file has `status: "A"`).
- Produces: `mergeBase(x): Promise<string>` in `src/ui.jsx`; `<Writer repos n height />` in `src/Writer.jsx`.

- [ ] **Step 1: Share the merge-base helper**

In `src/ui.jsx`, after the `mainOf` line, add:

```js
/** Where a repo's branch left main (origin's if fetched): diffing the working tree against it shows the branch the way its PR will, uncommitted work included. */
export const mergeBase = (x) => git(x.id, "merge-base", "HEAD", "origin/" + mainOf(x)).catch(() => git(x.id, "merge-base", "HEAD", mainOf(x))).then((s) => s.trim());
```

In `src/Main.jsx`, add `mergeBase` to the `./ui.jsx` import, and in `ProjectDiff` delete these two lines:

```js
  // the base is where the branch left main (origin's if fetched); diffing the working tree against it includes uncommitted work
  const base = (x) => git(x.id, "merge-base", "HEAD", "origin/" + mainOf(x)).catch(() => git(x.id, "merge-base", "HEAD", mainOf(x))).then((s) => s.trim());
```

and change `const b = await base(x)` to `const b = await mergeBase(x)`.

- [ ] **Step 2: Styles**

Append to `src/styles.css`:

```css
/* a writer project's text: a reading column with tracked changes */
.prose{max-width:70ch;margin:0 auto;padding:24px 28px 40px;font-size:14.5px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--fg)}
.prose .same{color:var(--soft)}
.prose .h{font-weight:600;font-size:16px}
.prose .ins{color:var(--add);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}
.prose .del{color:var(--del);text-decoration:line-through}
.prose .del+.ins{margin-left:.25em}
```

- [ ] **Step 3: Write `src/Writer.jsx`**

```jsx
// A writer project's text: every prose file changed on the branch as tracked changes (word by word, from git's own word diff),
// against main or one commit at a time.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { I, seg, git, mainOf, mergeBase } from "./ui.jsx";
import { splitDiff, parseWordDiff, allAdded, PROSE, PROSE_RE } from "./lib.js";

// quotePath off: a name like læring.md comes back as typed, not octal-escaped
const wdiff = (id, ...range) => git(id, "-c", "core.quotePath=false", "diff", "--word-diff=porcelain", "--no-renames", "-U99999", ...range, "--", ...PROSE);

/** One repo's prose files between two points (range: what git diff takes). withNew: also the files git doesn't track yet, as all inserted. */
const filesOf = async (x, range, withNew) => {
  const parts = splitDiff(await wdiff(x.id, ...range));
  const got = Object.entries(parts).map(([path, d]) => ({ repo: x.id, path, gone: /^deleted file mode/m.test(d), ...parseWordDiff(d) }));
  const fresh = !withNew ? [] : await Promise.all(x.changes.filter((c) => c.status === "A" && PROSE_RE.test(c.path) && !(c.path in parts))
    .map((c) => invoke("read_file", { id: x.id, path: c.path }).then((t) => ({ repo: x.id, path: c.path, ...allAdded(t) }))));
  return [...got, ...fresh];
};

const dim = { padding: 20, color: "var(--dim)" };

export function Writer({ repos, n, height = 560 }) {
  const [mode, setMode] = useState("main"), [at, setAt] = useState(0), [sel, setSel] = useState(null);
  const [info, setInfo] = useState(null); // per repo: { base, commits: [{ repo, sha, ct, msg }] } or { err }
  const [got, setGot] = useState(null);   // { k, files: [{ repo, path, lines, added, removed, gone }], err }
  const rkey = repos.map((x) => x.id + x.branch + x.changes.length).join();
  useEffect(() => {
    let dead = false;
    Promise.all(repos.filter((x) => x.git).map(async (x) => {
      try {
        const base = await mergeBase(x), log = await git(x.id, "log", "--reverse", "--format=%h%x09%ct%x09%s", base + "..HEAD", "--", ...PROSE);
        return [x.id, { base, commits: log.split("\n").filter(Boolean).map((l) => { const [sha, ct, ...m] = l.split("\t"); return { repo: x.id, sha, ct: +ct, msg: m.join("\t") }; }) }];
      } catch (e) { return [x.id, { err: String(e), commits: [] }]; }
    })).then((rs) => !dead && setInfo(Object.fromEntries(rs)));
    return () => { dead = true; };
  }, [rkey, n]); // eslint-disable-line react-hooks/exhaustive-deps
  // the steps: every commit that touched the text, oldest first across the repos, then what isn't committed yet
  const ok = repos.filter((x) => x.git && info?.[x.id] && !info[x.id].err);
  const wip = ok.some((x) => x.changes.some((c) => PROSE_RE.test(c.path)));
  const steps = [...ok.flatMap((x) => info[x.id].commits).sort((a, b) => a.ct - b.ct), ...(wip ? [{ wip: true }] : [])];
  const step = steps[Math.min(at, steps.length - 1)];
  const k = !info ? null : mode === "main" ? "main:" + rkey + n : step ? "step:" + (step.wip ? "wip" + rkey : step.repo + step.sha) + n : "none";
  useEffect(() => {
    if (!k) return;
    let dead = false;
    const work = k === "none" ? Promise.resolve([])
      : mode === "main" ? Promise.all(ok.map((x) => filesOf(x, [info[x.id].base], true)))
      : step.wip ? Promise.all(ok.map((x) => filesOf(x, ["HEAD"], true)))
      : filesOf(repos.find((x) => x.id === step.repo), [step.sha + "^", step.sha], false);
    work.then((fs) => ({ k, files: fs.flat() }), (e) => ({ k, files: [], err: String(e) })).then((g) => !dead && setGot(g));
    return () => { dead = true; };
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!repos.length) return <div style={{ color: "var(--dim)" }}>None of this project's repos are out of reserve.</div>;
  const files = got?.k === k ? got.files : null;
  const f = files && (files.find((g) => sel && g.repo === sel.repo && g.path === sel.path) || files[0]);
  const bad = repos.filter((x) => !x.git || info?.[x.id]?.err);
  const many = repos.length > 1, i = Math.min(at, steps.length - 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", height, borderRadius: 10, overflow: "hidden", boxShadow: "0 0 0 1px var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 12.5, flex: "none" }}>
        {seg([["Against main", mode === "main", () => setMode("main")], ["Step by step", mode === "steps", () => { setMode("steps"); setAt(Math.max(steps.length - 1, 0)); }]])}
        {mode === "steps" && steps.length > 0 && <>
          <button className="ib" title="Previous step" disabled={i <= 0} onClick={() => setAt(i - 1)}><I n="ph-caret-left" /></button>
          <span style={{ color: "var(--dim)", flex: "none" }}>{i + 1} of {steps.length}</span>
          <button className="ib" title="Next step" disabled={i >= steps.length - 1} onClick={() => setAt(i + 1)}><I n="ph-caret-right" /></button>
          <span className="ellip" title={step.wip ? "" : step.sha} style={{ minWidth: 0, fontWeight: 500 }}>{step.wip ? "Not committed yet" : step.msg}</span>
          {many && !step.wip && <span className="mono" style={{ fontSize: 11, color: "var(--dimmer)", flex: "none" }}>{step.repo}</span>}
        </>}
        <span className="spacer" />
        {bad.map((x) => <span key={x.id} title={info?.[x.id]?.err} style={{ fontSize: 11.5, color: "var(--dimmer)", flex: "none" }}>{x.id}: {x.git ? `no ${mainOf(x)} to compare with` : "not a git repo"}</span>)}
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ width: 240, flex: "none", overflow: "auto", padding: "6px 0", borderRight: "1px solid var(--border)" }}>
          {files?.map((g) => (
            <div key={g.repo + ":" + g.path} className="hov" title={(many ? g.repo + ": " : "") + g.path} onClick={() => setSel({ repo: g.repo, path: g.path })}
              style={{ display: "flex", alignItems: "center", gap: 7, height: 24, padding: "0 12px", fontSize: 12, background: g === f ? "color-mix(in srgb, var(--acc) 12%, transparent)" : undefined }}>
              <span className="ellip" style={{ flex: 1, minWidth: 0, direction: "rtl", textAlign: "left", textDecoration: g.gone ? "line-through" : undefined }}>{g.path}</span>
              {g.added > 0 && <span className="mono" style={{ fontSize: 11, color: "var(--add)" }}>+{g.added}</span>}
              {g.removed > 0 && <span className="mono" style={{ fontSize: 11, color: "var(--del)" }}>−{g.removed}</span>}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
          {!files ? <div style={dim}><I n="ph-circle-notch spin" /></div>
            : got.err ? <div style={dim}>{got.err}</div>
            : !f ? <div style={dim}>{mode === "steps" && !steps.length ? "No commits have touched the text yet." : "No text changes yet."}</div>
            : !f.lines.length ? <div style={dim}>Nothing to show for this file (empty, or not text).</div>
            : <div className="prose">
                {f.lines.map((l, j) => (
                  <div key={j} className={(/^#{1,6} /.test(l.map((r) => (r.t === "-" ? "" : r.s)).join("")) ? "h " : "") + (l.some((r) => r.t !== " ") ? "" : "same")}>
                    {l.length ? l.map((r, m) => (r.t === " " ? r.s : <span key={m} className={r.t === "+" ? "ins" : "del"}>{r.s}</span>)) : " "}
                  </div>
                ))}
              </div>}
        </div>
      </div>
    </div>
  );
}
```

Notes for the implementer:
- `k` names what is on screen; the second effect reruns only when it changes, and a late answer for an old `k` is ignored through `got.k === k`.
- With several repos the file list is flat and the repo is in the row's tooltip. The spec says "grouped by repo"; the rows come out in repo order, which is the grouping. Add a header row per repo only if it reads badly in the manual check with two repos.

- [ ] **Step 4: Wire it into the project page (`src/Main.jsx`)**

Add the import under the `Experiment` one:

```js
import { Writer } from "./Writer.jsx";
```

In `ProjectTab`, under the experiment line, add:

```jsx
  if (!tab && cfg.kind === "writer") return <Writer repos={repos} n={n} height={height} />;
```

In `popOut`, change the signature and the name line so the window title says Text:

```js
export const popOut = async (id, tab, first = "Report") => {
```

```js
  const name = tab === DIFF ? "Diff" : tab ? tab.replace(/\.html?$/i, "") : first;
```

In `ProjectHome`:

Replace:

```js
  const exp = cfg?.kind === "experiment";
  const where = exp ? "results.tsv" : rp.kind === "issue" ? `${rp.repo}${rp.issue ? "#" + rp.issue : ""}` : "REPORT.html";
```

with:

```js
  const exp = cfg?.kind === "experiment", wr = cfg?.kind === "writer";
  const first = exp ? "Results" : wr ? "Text" : "Report";
  const where = exp ? "results.tsv" : wr ? "How the text changed" : rp.kind === "issue" ? `${rp.repo}${rp.issue ? "#" + rp.issue : ""}` : "REPORT.html";
```

Hide the phase pills: change `{cfg && !exp && <div style={{ marginTop: 18,` to `{cfg && !exp && !wr && <div style={{ marginTop: 18,`.

In the tab row, replace `: exp ? "Results" : "Report"}` with `: first}`, and change the pop-out button's handler from `popOut(x.id, tab)` to `popOut(x.id, tab, first)`.

- [ ] **Step 5: The popped-out window (`src/ProjectWindow.jsx`)**

The window only loads the repos for the Diff tab. A writer project's first tab needs them too. Replace line 14:

```js
      const rs = tab === ":diff" ? await Promise.all((c.repos || []).map((r) => invoke("repo", { id: r }).catch(() => null))) : [];
```

with:

```js
      const rs = tab === ":diff" || (!tab && c.kind === "writer") ? await Promise.all((c.repos || []).map((r) => invoke("repo", { id: r }).catch(() => null))) : [];
```

and line 19:

```js
  const name = tab === ":diff" ? "Diff against main" : tab ? tab.replace(/\.html?$/i, "") : "Report";
```

with:

```js
  const name = tab === ":diff" ? "Diff against main" : tab ? tab.replace(/\.html?$/i, "") : cfg?.kind === "writer" ? "Text" : cfg?.kind === "experiment" ? "Results" : "Report";
```

- [ ] **Step 6: Build**

Run: `npm test && npm run build`
Expected: tests pass; vite builds without errors or unused-import warnings for `git`/`mainOf` in `src/Main.jsx` (both are still used elsewhere in that file).

- [ ] **Step 7: Check it by hand**

Run: `npm run tauri dev`. Ask the user to look rather than screenshotting the desktop. In a workfolder with a docs repo:

1. Start a project → Writing → name it, pick the repo, Create. Expect: no phase pills, first tab called "Text", "No text changes yet."
2. Edit a sentence in a tracked `.md` in the project's worktree. Within 10 s (or Refresh): the file is listed with `+n −m`, the old words struck through in red, the new ones underlined in green, unchanged lines slightly dimmed, `#` lines heavier.
3. Add a new untracked `docs/sub/læring.md`. Expect it listed under that name, all green.
4. Commit twice with different edits, then edit again without committing. Step by step: "3 of 3 · Not committed yet" first, back through the two commits by message; each shows only that step's changes.
5. `git rm` a tracked `.md`. Against main: listed struck through, its text all red.
6. Change a `.js` file. Expect it absent from Text and present in Diff.
7. Pop the Text tab out. Expect the same view, window titled "… · Text".
8. Park the repo in reserve. Expect "None of this project's repos are out of reserve."
9. Right-click the project → Start Claude here. Expect the first message to be the writer resume one.

- [ ] **Step 8: Commit**

```bash
git add src/Writer.jsx src/ui.jsx src/Main.jsx src/ProjectWindow.jsx src/styles.css
git commit -m "Writer projects: the text as tracked changes on the project page"
```

---

### Task 4: Tell people about it

**Files:**
- Modify: `README.md` (after the **Experiments** paragraph, line 7)

**Interfaces:** none.

`CHANGELOG.md` is not touched here. In this repo the changelog section, `VERSION` and the version in `package.json`, `Cargo.toml`, `Cargo.lock` and `tauri.conf.json` all change together in the separate "release vX" commit, and `parseChangelog` expects every `## ` heading to be a version. The entry for that commit is in Step 2, ready to paste.

- [ ] **Step 1: README**

Add after the Experiments paragraph:

```markdown
**Writing projects** are for texts meant to be read: documentation, a guide, an article. Claude writes and revises with you, one commit per revision, and the project page shows the text as tracked changes, word by word: everything against main, or one commit at a time. Claude may still change code when the text needs it; that shows in the Diff tab.
```

- [ ] **Step 2: Hand over the changelog entry**

Give the user this line for the release commit; do not write it to `CHANGELOG.md`:

```markdown
- **Writing projects:** a third kind of project, next to Phases and Experiment, for texts meant to be read. Its page shows how the text changed word by word, like tracked changes: everything against main, or step by step through the commits, with what isn't committed yet as the last step. It covers Markdown, plain text, reStructuredText, AsciiDoc and LaTeX files; code changes stay in the Diff tab. The text is shown as written, not as rendered Markdown.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Writer projects: README"
```
