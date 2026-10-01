const C = { text: "var(--code)", kw: "var(--syn-kw)", str: "var(--syn-str)", num: "var(--syn-num)", fn: "var(--syn-fn)", type: "var(--syn-type)", com: "var(--syn-com)", punc: "var(--syn-punc)" };
const KW = new Set(("import from export const let var async await return if else function new typeof describe it expect null true false default interface type class extends " +
  "for while in of break continue try catch throw fn pub mut use mod struct enum impl trait match self Self crate where as loop move ref def lambda None True False elif pass with yield package func go defer").split(" "));

// ponytail: regex highlighter from the design, per line (no multi-line strings/comments); swap for tree-sitter/shiki if it matters
export function tok(line) {
  const out = [], re = /(\/\/.*$|#.*$)|('[^']*'|"[^"]*"|`[^`]*`)|(\b\d+\b)|([A-Za-z_$][\w$]*)|(\s+)|(.)/g;
  let m;
  while ((m = re.exec(line))) {
    let c = C.text, s = "normal";
    if (m[1]) { c = C.com; s = "italic"; }
    else if (m[2]) c = C.str;
    else if (m[3]) c = C.num;
    else if (m[4]) { if (KW.has(m[4])) c = C.kw; else if (line[re.lastIndex] === "(") c = C.fn; else if (/^[A-Z]/.test(m[4])) c = C.type; }
    else if (m[6]) c = C.punc;
    out.push({ t: m[0], c, s });
  }
  return out;
}

/** `git diff` text -> [{header, rows: [{sign, code, o, n}]}] with old/new line numbers. */
export function parseDiff(s) {
  const hunks = [];
  let h = null, o = 0, n = 0;
  for (const l of s.replace(/\n$/, "").split("\n")) {
    const m = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (m) { o = +m[1]; n = +m[2]; hunks.push((h = { header: l, rows: [] })); continue; }
    if (!h || l.startsWith("\\")) continue;
    const sign = l[0] || " ", code = l.slice(1);
    if (sign === "+") h.rows.push({ sign, code, o: "", n: n++ });
    else if (sign === "-") h.rows.push({ sign, code, o: o++, n: "" });
    else h.rows.push({ sign: " ", code, o: o++, n: n++ });
  }
  return hunks;
}

/** Pairs a hunk's -/+ runs side by side; k: ' ' context, '-', '+', 'x' filler. */
export function splitRows(rows) {
  const out = [];
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    if (r.sign === " ") { out.push({ l: { n: r.o, code: r.code, k: " " }, r: { n: r.n, code: r.code, k: " " } }); i++; continue; }
    const dels = [], adds = [];
    while (i < rows.length && rows[i].sign === "-") dels.push(rows[i++]);
    while (i < rows.length && rows[i].sign === "+") adds.push(rows[i++]);
    for (let j = 0; j < Math.max(dels.length, adds.length); j++)
      out.push({
        l: dels[j] ? { n: dels[j].o, code: dels[j].code, k: "-" } : { n: "", code: "", k: "x" },
        r: adds[j] ? { n: adds[j].n, code: adds[j].code, k: "+" } : { n: "", code: "", k: "x" },
      });
  }
  return out;
}

/** Sorted file paths -> visible tree rows; children show only when isOpen(dir) for every ancestor. */
export function buildTree(paths, isOpen) {
  const out = [], seen = new Set();
  for (const p of paths) {
    const parts = p.split("/");
    let visible = true;
    for (let i = 0; i < parts.length - 1 && visible; i++) {
      const d = parts.slice(0, i + 1).join("/");
      if (!seen.has(d)) { seen.add(d); out.push({ path: d, name: parts[i], depth: i, dir: true }); }
      visible = !!isOpen(d);
    }
    if (visible) out.push({ path: p, name: parts.at(-1), depth: parts.length - 1, dir: false });
  }
  return out;
}

export function ago(iso, now = Date.now()) {
  const s = (now - new Date(iso)) / 1000;
  for (const [n, u] of [[31536000, "y"], [2592000, "mo"], [604800, "w"], [86400, "d"], [3600, "h"], [60, "m"]]) if (s >= n) return Math.floor(s / n) + u + " ago";
  return "just now";
}

const checkKind = (c) => {
  const v = (c.conclusion || c.state || "").toUpperCase();
  if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(v)) return "pass";
  if (["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(v)) return "fail";
  return "pending";
};

/** `gh pr list --json ...` row -> the shape the PR panel renders. */
export function mapPR(p) {
  const state = p.state === "MERGED" ? "merged" : p.state === "CLOSED" ? "closed" : p.isDraft ? "draft" : "open";
  return {
    num: p.number, title: p.title, head: p.headRefName, base: p.baseRefName, author: p.author?.login || "", body: p.body, url: p.url, state,
    when: (state === "merged" ? "merged " : "opened ") + ago(p.createdAt),
    review: { APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested", REVIEW_REQUIRED: "Review required" }[p.reviewDecision] || "No reviews",
    reviewers: (p.reviewRequests || []).map((x) => x.login || x.slug || x.name),
    checks: (p.statusCheckRollup || []).map((c) => ({ k: checkKind(c), label: c.name || c.context, detail: (c.conclusion || c.status || c.state || "").toLowerCase().replace(/_/g, " ") })),
    files: (p.files || []).map((f) => ({ path: f.path, adds: f.additions, dels: f.deletions })),
  };
}

/** "## 1.2.0 — date" sections, newest first: [{ version, date, items: [markdown line] }] */
export function parseChangelog(md) {
  return md.split(/^## /m).slice(1).map((sec) => {
    const [head, ...rest] = sec.split("\n");
    const [version, date = ""] = head.split(/\s+[—-]\s+/);
    return { version: version.trim(), date: date.trim(), items: rest.filter((l) => l.startsWith("- ")).map((l) => l.slice(2)) };
  });
}

export const newer = (a, b) => {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

/** The sections after `since` up to and including `current`; just `current` when `since` is unknown. */
export function sectionsSince(md, since, current) {
  const all = parseChangelog(md).filter((s) => !newer(s.version, current));
  return since ? all.filter((s) => newer(s.version, since)) : all.slice(0, 1);
}

/**
 * How the reserve is split up: your own groups first, then the last session's set, then one bucket per
 * "used in the last N days" setting, then everything else. A repo shows in exactly one group.
 * `used` maps repo id -> when it was last active; `groups` is [{ name, repos: [id] }].
 */
export function reserveGroups(parked, { used = {}, lastSet = [], days = [], groups = [], now = Date.now() }) {
  const out = [], taken = new Set();
  const byUse = (a, b) => (used[b.id] || 0) - (used[a.id] || 0) || a.id.localeCompare(b.id);
  const take = (key, label, items, extra) => { items.forEach((x) => taken.add(x.id)); out.push({ key, label, items, ...extra }); };
  for (const g of groups) take("g:" + g.name, g.name, parked.filter((x) => g.repos.includes(x.id)).sort(byUse), { custom: true });
  const free = () => parked.filter((x) => !taken.has(x.id));
  const last = free().filter((x) => lastSet.includes(x.id)).sort(byUse);
  if (last.length) take("last", "Last used", last);
  for (const d of [...new Set(days)].filter((d) => d > 0).sort((a, b) => a - b)) {
    const items = free().filter((x) => used[x.id] && now - used[x.id] <= d * 86400e3).sort(byUse);
    if (items.length) take("d:" + d, `Last ${d} day${d === 1 ? "" : "s"}`, items);
  }
  const rest = free().sort((a, b) => a.id.localeCompare(b.id));
  if (rest.length) take("other", out.length ? "Other" : "", rest);
  return out;
}

/** One GitHub event in words: "pushed to feat/login", "opened PR #12". */
export function describeEvent(e) {
  const n = e.num ? " #" + e.num : "";
  switch (e.type) {
    case "PushEvent": return "pushed to " + e.ref;
    case "CreateEvent": return e.ref ? "created " + e.ref : "created the repo";
    case "DeleteEvent": return "deleted " + e.ref;
    case "PullRequestEvent": return `${e.action === "closed" ? "closed" : e.action} PR${n}`;
    case "PullRequestReviewEvent": return "reviewed PR" + n;
    case "PullRequestReviewCommentEvent": return "commented on PR" + n;
    case "IssueCommentEvent": return "commented on" + n;
    case "IssuesEvent": return `${e.action} issue${n}`;
    case "ReleaseEvent": return "published a release";
    default: return (e.type || "").replace(/Event$/, "").toLowerCase();
  }
}

/**
 * Who else worked on a repo lately, from its GitHub events ({ login, at, type, ref?, num?, action? }):
 * [{ login, at, what, branches }] newest first, one per person, bots and `me` left out.
 * `what` describes their latest event; `branches` are the ones they pushed to in the window.
 */
export function othersActive(events, me, days = 7, now = Date.now()) {
  const seen = new Map();
  for (const e of events) {
    const t = Date.parse(e.at);
    if (!e.login || e.login === me || e.login.endsWith("[bot]") || now - t > days * 864e5) continue;
    const p = seen.get(e.login) || { login: e.login, t: 0, branches: [] };
    if (t > p.t) Object.assign(p, { t, at: new Date(t).toISOString(), what: describeEvent(e) });
    if (e.type === "PushEvent" && e.ref && !p.branches.includes(e.ref)) p.branches.push(e.ref);
    seen.set(e.login, p);
  }
  return [...seen.values()].sort((a, b) => b.t - a.t).map(({ t, ...p }) => p);
}

const hex = (h, s, l) => {
  const f = (n) => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0"); };
  return "#" + f(0) + f(8) + f(4);
};
/** A popped-out terminal's colours for a hue: pastel title bar with dark ink, and a background tinted to match the theme. Hex, since xterm wants plain colours. */
export const pastel = (hue, dark = true) => ({ bar: hex(hue, 0.7, 0.8), ink: hex(hue, 0.35, 0.18), bg: dark ? hex(hue, 0.22, 0.12) : hex(hue, 0.6, 0.965) });

/** Snap layouts for popped-out terminals: "off", "edges" (halves and quarters, like a desktop), or a "<cols>x<rows>" grid. */
export const GRIDS = ["off", "edges", "2x2", "3x2", "3x3", "4x2"];
/** Columns × rows for n tiles in the dual-screen terminals window: as square as it gets, wider than tall. */
export const autoGrid = (n) => { const cols = Math.ceil(Math.sqrt(n)) || 1; return { cols, rows: Math.ceil(n / cols) || 1 }; };
/** A fixed hue per repo name, so a repo's terminals keep one colour. */
export const hueOf = (s = "") => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
/** A repo's hue by its place in `list`, a golden-angle step apart so neighbours never look alike; its name's hue when it isn't listed. */
// ponytail: past ~8 repos hues start to come close; pair hue with lightness if that many share a screen
export const repoHue = (id, list) => { const i = list.indexOf(id); return i < 0 ? hueOf(id) : (i * 137.5) % 360; };
const GAP = 4;
/** Cell (col, row) of a cols×rows grid over a W×h area, spanning `span` columns and `spanR` rows, with gaps. */
export function cellRect(col, row, cols, rows, W, h, span = 1, spanR = 1) {
  const cw = (W - (cols + 1) * GAP) / cols, ch = (h - (rows + 1) * GAP) / rows;
  return { x: Math.round(GAP + col * (cw + GAP)), y: Math.round(GAP + row * (ch + GAP)), w: Math.round(span * cw + (span - 1) * GAP), h: Math.round(spanR * ch + (spanR - 1) * GAP) };
}

/**
 * Where a popped-out terminal lands when dropped with the pointer at (x, y) in a W×H window.
 * The bottom edge always docks it ("dock"). With a grid it fills the cell under the pointer; with "edges",
 * an edge takes a half, a corner a quarter and the top edge the whole window. null: drop it where it is.
 * `bar` is the status bar height left free at the bottom.
 */
export function snapZone(x, y, W, H, grid = "edges", bar = 26, edge = 24, corner = 80) {
  const h = H - bar;
  if (y > H - edge) return "dock";
  if (grid === "off") return null;
  const m = /^(\d+)x(\d+)$/.exec(grid);
  if (m) {
    const cols = +m[1], rows = +m[2];
    return cellRect(Math.min(cols - 1, Math.floor(x / (W / cols))), Math.min(rows - 1, Math.floor(y / (h / rows))), cols, rows, W, h);
  }
  const L = x < edge, R = x > W - edge, T = y < edge;
  const cl = x < corner, cr = x > W - corner, ct = y < corner, cb = y > H - corner;
  if ((L && ct) || (T && cl)) return cellRect(0, 0, 2, 2, W, h);
  if ((R && ct) || (T && cr)) return cellRect(1, 0, 2, 2, W, h);
  if (L && cb) return cellRect(0, 1, 2, 2, W, h);
  if (R && cb) return cellRect(1, 1, 2, 2, W, h);
  if (L) return cellRect(0, 0, 2, 1, W, h);
  if (R) return cellRect(1, 0, 2, 1, W, h);
  if (T) return cellRect(0, 0, 1, 1, W, h);
  return null;
}

/** True when two { x, y, w, h } rectangles share more than a sliver (`slack` px) in both directions. */
export const overlaps = (a, b, slack = 8) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > slack && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > slack;

/** `git grep -n -z` output ("path\0line\0text\n" per hit) -> [{ path, line, text }] */
export const parseGrep = (out) => out.split("\n").filter(Boolean).map((l) => {
  const [path, line, ...text] = l.split("\0");
  return { path, line: +line, text: text.join("\0").trim() };
});

/** `gh issue list --json ...` row -> the shape the Issues panel renders. */
export const mapIssue = (i) => ({
  num: i.number, title: i.title, state: i.state === "CLOSED" ? "closed" : "open", author: i.author?.login || "", body: i.body, url: i.url,
  when: "opened " + ago(i.createdAt), labels: (i.labels || []).map((l) => ({ name: l.name, color: "#" + l.color })),
  assignees: (i.assignees || []).map((a) => a.login),
  comments: (i.comments || []).map((c) => ({ author: c.author?.login || "", body: c.body, when: ago(c.createdAt) })),
});

/** Fuzzy filter: every word of `q` appears in `text` in order, gaps allowed ("lgn fx" matches "login fix"). Case-insensitive. */
export const fuzzy = (q, text) => {
  const t = text.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => {
    let i = 0;
    for (const c of t) if (c === w[i]) i++;
    return i === w.length;
  });
};

// ---- projects ("Start a project"): a folder with its repos linked inside and a CLAUDE.md on how to report back ----

/** The repo list of a project's CLAUDE.md, between markers so adding repos later rewrites only this part. */
export const projectRepos = (repos) =>
  "<!-- nimbus:repos -->\n" + repos.map((x) => `- \`${x.id}/\`` + (x.remote ? ` (github.com/${x.remote})` : "")).join("\n") + "\n<!-- /nimbus:repos -->";

/** A project's own checkout of a repo: the worktree <repo>@<project> on a branch named after the project,
 * so two projects on the same repo never share a checkout. */
export const projBranch = (name) => name.trim().replace(/\s+/g, "-");
export const projTree = (repo, name) => `${repo}@${projBranch(name)}`;
/** The repo a project member is a checkout of (members made before worktrees are the repo itself). */
export const treeRepo = (id) => id.split("@")[0];

/** A project's phases, in order. `phase` in .nimbus-project.json is the id of the current one; Claude moves it on. */
export const PHASES = [
  { id: "start", label: "Start", does: "Pin down the goal, scope, acceptance criteria and a plan: which repos change, in what order, on which branches. Ask the user everything unclear. If the goal is more than one PR's worth, split it into sprints, each a shippable step with its own acceptance criteria, and within a repo into stacked PRs (each branch on top of the previous one, small enough to review alone) where the changes build on each other. A small goal stays one sprint, one PR per repo.", report: "Plan: the approach, the sprints in order with what each delivers, each repo with what changes in it and its branch name (for a stack: the branches in order, each with the branch it is based on), acceptance criteria as a task list per sprint, open questions.", exit: "the user has approved the plan" },
  { id: "dev", label: "Development", does: "Work sprint by sprint, in plan order. Create a branch per repo (a git worktree when work runs in parallel), build it in small commits, push and open draft PRs early. For a stack, base each PR on the branch below it and say in its description where it sits in the stack; after changing a lower branch, rebase the ones above and force-push with lease. Tell the user when a sprint is done before starting the next.", report: "Work: per sprint a table of repo, branch/worktree, base branch and draft PR; the plan's tasks ticked off as they land.", exit: "everything in the plan is built and pushed" },
  { id: "test", label: "Testing", does: "Run each repo's tests and builds, add tests for what changed, try it end to end across the repos.", report: "Testing: per repo what ran and the result, what was checked by hand, bugs found and fixed.", exit: "every acceptance criterion is checked, tests pass" },
  { id: "review", label: "Review", does: "Mark the PRs ready, request reviews, answer every comment with a fix or a reason, ask the user to try it.", report: "Review: each PR with reviewers and state, the feedback and what was done about it.", exit: "PRs are approved and the user signs off" },
  { id: "merge", label: "Merge", does: "Work out the merge order from what depends on what across the repos (shared libs, APIs, migrations first) and how each repo deploys, and agree it with the user before merging anything. A stack merges from the bottom up: after each merge, point the next PR at main and rebase it. Then go one step at a time: merge, wait for CI on main, deploy or release if that repo does, check it works there, and only then the next. If a step fails, stop, say so and roll back or fix forward with the user.", report: "Merge: the merge plan as an ordered table (step, repo, PR, depends on, deploy target, rollback), each step ticked with merged / CI / deployed / verified and times as it happens; then follow-ups left for later.", exit: "every step is merged, deployed where it applies and verified; then remove worktrees and merged branches, and close the report issue if there is one" },
];

/** Script Nimbus puts in every project page: nimbus.onData(fn) gets <page>.json (null if none) now and whenever it changes; nimbus.save(data) writes it. */
export const PAGE_BRIDGE = `<script>window.nimbus={data:undefined,onData(f){this.fn=f;if(this.data!==undefined)f(this.data)},save(d){this.data=d;parent.postMessage({nimbus:"save",data:d},"*")}};addEventListener("message",(e)=>{if(e.source===parent&&e.data&&"nimbusData" in e.data){nimbus.data=e.data.nimbusData;nimbus.fn&&nimbus.fn(nimbus.data)}})</script>`;

/** A page with the bridge right after <head> (or the doctype), so it runs before the page's own scripts and never knocks it into quirks mode. */
export const withBridge = (html) => {
  const m = html.match(/<head(\s[^>]*)?>/i) || html.match(/<!doctype[^>]*>/i), at = m ? m.index + m[0].length : 0;
  return html.slice(0, at) + PAGE_BRIDGE + html.slice(at);
};

/** First messages for a project's Claude: START when the project is new, KICKOFF when coming back to it. Empty sends none. */
export const START = "We're starting this project. Read CLAUDE.md, look through the repos and set up the report as it describes. We're in the Start phase: ask me anything unclear, then propose the plan.";
export const KICKOFF = "Read CLAUDE.md and the phase in .nimbus-project.json, check the current state of the repos and the report, then tell me where we are in this phase and what you'd do next.";

/** `claude` with a first message, quoted for any POSIX shell or fish; newlines become spaces since it is typed into a prompt. */
// dropped files go into a shell as single-quoted paths, space-separated with a trailing space, like GNOME Terminal does
export const quotePaths = (paths) => paths.map((p) => "'" + p.replaceAll("'", "'\\''") + "' ").join("");

// with exe (Nimbus's own binary) Claude also gets the nimbus MCP tools (`nimbus mcp`, see mcp.rs), allowed without asking,
// and hooks (`nimbus hook <state>`) that mark its repo in the sidebar: working, waiting for you, done
const HOOKS = { UserPromptSubmit: "working", PostToolUse: "working", Notification: "waiting", Stop: "done" };
export const claudeCmd = (msg, exe) => {
  const q = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
  const hooks = exe && Object.fromEntries(Object.entries(HOOKS).map(([ev, st]) => [ev, [{ hooks: [{ type: "command", command: q(exe) + " hook " + st }] }]]));
  const mcp = exe ? " --mcp-config " + q(JSON.stringify({ mcpServers: { nimbus: { command: exe, args: ["mcp"] } } })) + " --allowedTools mcp__nimbus --settings " + q(JSON.stringify({ hooks })) : "";
  return "claude" + (msg?.trim() ? " " + q(msg.trim().replace(/\s*\n\s*/g, " ")) : "") + mcp;
};

/** Swaps the repo list in an existing CLAUDE.md; leaves everything else (your edits, Claude's notes) alone. */
export const withRepos = (md, repos) => md.replace(/<!-- nimbus:repos -->[\s\S]*?<!-- \/nimbus:repos -->/, projectRepos(repos));

/** Starting REPORT.json for an html project: the phases as pipeline stages, rendered by report.html. */
export const reportSeed = ({ name, goal, repos }) => ({
  project: { name, summary: goal.trim(), repos: repos.map((x) => ({ name: x.remote || x.id })), owner: "claude", updated: "" },
  metrics: [],
  stages: PHASES.map((p, i) => ({ id: p.id, name: p.label, status: i ? "pending" : "active", summary: "" })),
  blockers: [], questions: [], next: [], decisions: [], links: [], activity: [],
});

/** CLAUDE.md for a new project. report: { kind: "issue", repo, issue } or { kind: "html" }. */
export function projectMd({ name, goal, repos, report }) {
  const layout = `- It opens with a header: the repos with their branches, when it was updated, then the phase line with the current one in bold and a status word (on track / blocked / failed), e.g. \`${PHASES.map((p, i) => (i === 0 ? "✓ " : i === 1 ? "● " : "○ ") + p.label).join(" → ")}\` · 1/5 done · on track.
- Then a one-row table of key metrics when there are any (tests passing, coverage, diff size, ...), each with its change since last time.
- Then the pipeline: one section per phase in order, headed by its status (✓ done, ● in progress, ○ pending, ! blocked, ✕ failed) and dates. Each holds what that phase reports (see Phases): a short summary, its tasks as a task list (\`- [x]\`), test results as a table (suite, pass, fail, skip, time, with a total row), reviewers with their verdict, PRs with base ← head, +/- lines and their checks. Collapse done phases in \`<details>\`.
- Then: ▲ Blockers & risks (severity, what, owner), Questions for the user, → Next steps (numbered), Decisions (date, what, why), Links, and an Activity log (newest first, time, phase, what happened).
- It is a living report: update it in place after every piece of work, never start over.`;
  const where = report.kind === "issue"
    ? `Report in the body of the GitHub issue ${report.issue ? `**${report.repo}#${report.issue}**` : `for this project in **${report.repo}**`}: the issue body is the project's report, like a page the user reads on GitHub.

${report.issue ? "" : `There is no issue yet. Before anything else, open one titled "${name}" whose body is the report below
(\`gh issue create --repo ${report.repo} --title ... --body-file -\`), then write its number in place of "for this project in" above and as \`report.issue\` in .nimbus-project.json (Nimbus opens it from there), and delete this paragraph.\n\n`}${layout}
- Rewrite the body with \`gh issue edit <n> --repo ${report.repo} --body-file -\`. Next steps and each phase's tasks are task lists: tick what is done, add what you discover.
- Keep it short enough to read in a minute; keep the activity log to the last ten entries.
- After each update also post a one or two line comment saying what changed (\`gh issue comment <n> --repo ${report.repo} --body-file -\`), so watchers get notified.`
    : `Report in **REPORT.json** in this folder. **REPORT.html** is a finished page that renders it (header, metrics, the phases as a pipeline, blockers, next steps, decisions, links, activity log): don't edit the HTML, only the JSON. Its shape:

\`\`\`
{ "project": { "name", "summary", "repos": [{ "name", "branch" }], "owner", "updated" },
  "metrics": [{ "label", "value", "delta", "trend": "good|bad|neutral", "note" }],
  "stages": [{ "id", "name", "status": "done|active|pending|blocked|failed", "started", "finished", "summary",
    "tasks": [{ "text", "done" }], "tests": [{ "suite", "passed", "failed", "skipped", "duration" }],
    "reviews": [{ "who", "verdict": "requested|approved|changes|commented", "note" }],
    "prs": [{ "repo", "number", "title", "url", "base", "head", "additions", "deletions", "checks": [{ "name", "status" }] }] }],
  "blockers": [{ "severity": "high|med|low", "kind": "blocker|risk", "text", "owner" }], "questions": ["..."],
  "next": ["..."], "decisions": [{ "date", "text", "why" }], "links": [{ "label", "url", "short" }],
  "activity": [{ "time", "stage", "status", "text" }] }
\`\`\`

- The stages are the five phases, in order: keep each one's status, dates and what it reports (see Phases) in its fields; put what doesn't fit a field in its summary.
- Set \`updated\` on every write; add to the activity log newest first and keep its last ten entries.
- It is a living report: update it in place after every piece of work, never start over.`;
  return `# Project: ${name}

This folder is a project in Nimbus. The repos it covers are linked inside it, each as this project's own worktree on the branch \`${projBranch(name)}\` (made from main), so other projects on the same repos don't get in the way. Each is its own git repo; commit, branch and open pull requests per repo:

${projectRepos(repos)}

## Goal

${goal.trim() || "(not written yet: ask the user for it, then fill it in here)"}

## Phases

The project goes through these phases in order. The current one is \`phase\` in .nimbus-project.json (Nimbus shows it on the project page).
Work only on the current phase. When its exit is met, say so and ask the user; with their OK set \`phase\` to the next one and update the report.
The user may also move it themselves, forward or back (back to Development after review feedback is normal).
When Nimbus started you, you have its \`nimbus\` tools: use \`set_phase\` rather than editing .nimbus-project.json, \`page_data_get\`/\`page_data_set\` for a page's .json (the page updates at once), \`notify\` when a sprint is done or you need the user, and \`show\`/\`open_file\` to put something in front of them.

${PHASES.map((p, i) => `${i + 1}. **${p.label}** (\`${p.id}\`): ${p.does}
   - Report section: ${p.report}
   - Done when ${p.exit}.`).join("\n")}

## Reporting back

${where}

Report at the end of every piece of work, and straight away when you get stuck. Each report says:

- **Goal**: restated in a sentence, so drift is visible.
- **Done**: what changed, with repo, branch and PR links.
- **Outstanding**: what is left, in order.
- **Difficulties**: anything blocking you, anything you guessed at, and questions for the user.

Write for someone who has not followed the session. Be honest about what is unfinished or untested.

## Other pages

Any other \`.html\` file at the top of this folder shows as its own tab next to the report in Nimbus. Keep each one self-contained (inline CSS and scripts, no external files) and in the report's look: dark, monospace headings, small uppercase section captions, thin-bordered cards, status colours green done / violet in progress / grey pending / amber blocked / red failed (copy the CSS variables from REPORT.html when it exists).

Pages can be interactive. Nimbus gives every page (REPORT.html too) \`nimbus.onData(fn)\`, which calls \`fn\` with the contents of the page's .json file (PLAN.html has PLAN.json; \`null\` when there is none yet) and again whenever the file changes, and \`nimbus.save(data)\`, which writes \`data\` to that file. Keep a page's state in its .json and render from it, never bake it into the HTML, so what the user ticks or types survives and you can read it.

- From the Start phase on, keep **PLAN.html**: the plan as an interactive page. Sprints in order, each with its repos, branches and tasks as checkboxes the user can tick, notes the user can add to a task, and the open questions with a box to answer each. Its state (sprints, tasks with done flags, notes, questions and answers) lives in PLAN.json. Read PLAN.json before each piece of work, since the user may have ticked, edited or answered things there; update it when you change the plan or finish a task. The report's Plan section stays a short summary that points to it.

- If the work touches database structure (tables, columns, keys, constraints, migrations), keep **UML.html**: a UML diagram of the affected tables with PK/FK/UQ markers, relations and their on-delete behaviour (cascade, restrict, set null), new or changed tables set apart from existing ones, a legend, and a matrix of what happens on delete for each new table × parent. Update it whenever the schema changes.
`;
}
