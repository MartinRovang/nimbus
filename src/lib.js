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
