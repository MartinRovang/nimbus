import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import Term from "./Term.jsx";
import Wizard from "./Wizard.jsx";
import Settings, { gridName } from "./Settings.jsx";
import Changelog from "./Changelog.jsx";
import { getVersion } from "@tauri-apps/api/app";
import { store, settings, saveSettings, SIZES } from "./settings.js";
import { reg, subscribe, host, emit } from "./plugins.js";
import { Splash, checkUpdate, install } from "./Boot.jsx";
import { SEV, ReviewPanel, Report, reportMarkdown } from "./Review.jsx";
import { tok, parseDiff, splitRows, buildTree, ago, mapPR, reserveGroups, othersActive, pastel, snapZone, cellRect, GRIDS, overlaps, parseGrep, mapIssue, fuzzy } from "./lib.js";

const ST = { M: "var(--mod)", A: "var(--add)", D: "var(--del)", R: "var(--mod)", U: "var(--del)" };
const ADD_BG = "color-mix(in srgb, var(--add) 9%, transparent)", DEL_BG = "color-mix(in srgb, var(--del) 10%, transparent)", EMPTY_BG = "color-mix(in srgb, var(--fg) 1.8%, transparent)";
const PRC = { open: "var(--add)", merged: "var(--acc-soft)", draft: "var(--mid)", closed: "var(--del)" };
const CHK = { pass: ["ph-check-circle", "var(--add)"], fail: ["ph-x-circle", "var(--del)"], pending: ["ph-circle-dashed", "var(--mod)"] };
const LANG = { ts: "TypeScript", tsx: "TypeScript React", js: "JavaScript", jsx: "JavaScript React", json: "JSON", md: "Markdown", rs: "Rust", py: "Python", go: "Go", toml: "TOML", yml: "YAML", yaml: "YAML", css: "CSS", html: "HTML", sh: "Shell", swift: "Swift", tf: "HCL" };
const MAC = navigator.platform.startsWith("Mac");
const K = MAC ? "⌘" : "Ctrl+", SH = MAC ? "⇧" : "Shift+";
const EMPTY = { id: "", remote: "", branch: "", branches: [], changes: [], commits: [], stashes: [], git: true };
const KEYS = [["Files", K + "1"], ["Changes", K + "2"], ["Pull requests", K + "3"], ["Issues", K + "4"], ["Search all repos", K + SH + "F"], ["Switch branch", K + SH + "B"], ["Add repo or folder", K + "O"],
  ["Review changes with AI", K + SH + "R"], ["Commit", K + "Enter"], ["Toggle sidebar", K + "\\"], ["Command palette", K + "K"], ["Settings", K + ","],
  ["Terminal", "⌃`"], ["Hide popped-out terminals", "⌃⇧`"], ["Keyboard shortcuts", K + "/"], ["Close", "Esc"]];
const keyRows = KEYS.map(([a, b]) => [<span key={a}>{a}</span>, <span key={a + "k"}>{b}</span>]);
const ISSUE_FIELDS = "number,title,state,author,labels,assignees,createdAt,body,url,comments";
const PR_FIELDS = "number,title,headRefName,baseRefName,author,state,isDraft,reviewDecision,statusCheckRollup,createdAt,body,files,url";

const git = (id, ...args) => invoke("git", { id, args });
const gh = (id, ...args) => invoke("gh", { id, args });
const Toks = ({ code }) => tok(code).map((t, i) => <span key={i} style={{ color: t.c, fontStyle: t.s }}>{t.t}</span>);
const I = ({ n, style }) => <i className={"ph " + n} style={style} />;

/** A drag handle on a panel edge. `grow` is +1 when dragging right/down makes the panel bigger. */
function Resizer({ axis, grow, value, min, max, set, reset, style }) {
  const down = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget, from = axis === "x" ? e.clientX : e.clientY;
    el.setPointerCapture(e.pointerId);
    document.body.classList.add("dragging-" + axis);
    const move = (ev) => set(Math.round(Math.min(max(), Math.max(min, value + grow * ((axis === "x" ? ev.clientX : ev.clientY) - from)))));
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); document.body.classList.remove("dragging-" + axis); set(null); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  return <div className={"resizer " + axis} onPointerDown={down} onDoubleClick={reset} title="Drag to resize, double-click to reset" style={style} />;
}

let parkedAtStart = false;

export default function App({ bootError }) {
  const [wf, setWf] = useState(null);
  const [user, setUser] = useState(null);
  const [active, setActive] = useState("");
  const [panel, setPanelRaw] = useState("files");
  const lastPanel = useRef("files");
  const [expanded, setExpanded] = useState(true);
  const [openDirs, setOpenDirs] = useState({});
  const [paths, setPaths] = useState({});
  const [open, setOpen] = useState(null);
  const [view, setView] = useState("code");
  const [diffStyle, setDiffStyle] = useState(settings.diffStyle);
  const [doc, setDoc] = useState({ text: "", diff: "", err: "" });
  const [commitMsg, setCommitMsg] = useState("");
  const [toast, setToast] = useState(null);
  const [ov, setOv] = useState(null); // one overlay at a time: branch | add | palette | repoMenu | keys | multi
  const [sq, setSq] = useState(""); // cross-repo search
  const [hits, setHits] = useState(null); // { repo: [{ path, line, text }] }, null before the first search
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false); // the results pop-out above the status bar
  const searchBox = useRef();
  const [mc, setMc] = useState({ msg: "", branch: "", pr: false, pick: [] }); // commit across repos
  const [q, setQ] = useState("");
  const [pIdx, setPIdx] = useState(0);
  const [addTab, setAddTab] = useState("github");
  const [urlVal, setUrlVal] = useState("");
  const [ghRepos, setGhRepos] = useState(null);
  const [cloning, setCloning] = useState([]);
  const [reserveOpen, setReserveOpen] = useState(true);
  const [allMain, setAllMain] = useState(false);
  const [amStash, setAmStash] = useState(true);
  const [amPull, setAmPull] = useState(true);
  const [prs, setPrs] = useState({});
  const [prCompact, setPrCompact] = useState(() => store.get("nb.prCompact", false));
  const [prFilter, setPrFilterRaw] = useState(() => store.get("nb.prFilter", "open"));
  const setPrFilter = (f) => { setPrFilterRaw(f); store.set("nb.prFilter", f); };
  const [openPR, setOpenPR] = useState(null);
  const [issues, setIssues] = useState({});
  const [issueFilter, setIssueFilterRaw] = useState(() => store.get("nb.issueFilter", "open"));
  const setIssueFilter = (f) => { setIssueFilterRaw(f); store.set("nb.issueFilter", f); };
  const [openIssue, setOpenIssue] = useState(null); // { repo, num }
  const [issueCompact, setIssueCompact] = useState(() => store.get("nb.issueCompact", false));
  const [prQ, setPrQ] = useState(""), [issueQ, setIssueQ] = useState(""); // fuzzy filters in the PR and Issues panels
  const [terms, setTerms] = useState([]);
  const [termOpen, setTermOpen] = useState(false);
  const [review, setReview] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [revQ, setRevQ] = useState("");
  const [revStats, setRevStats] = useState({});
  const [ctx, setCtx] = useState(null);
  const [localDirs, setLocalDirs] = useState(null);
  const [lastSet, setLastSet] = useState(() => store.get("nb.lastSet", []));
  const [wizard, setWizard] = useState(() => !store.get("nb.setupDone", false));
  const [update, setUpdate] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [whatsNew, setWhatsNew] = useState(null);
  const [used, setUsed] = useState(() => store.get("nb.used", {})); // repo id -> when it was last the active repo
  const [groups, setGroupsState] = useState(settings.groups); // your own reserve groups: [{ name, repos }]
  const [collapsed, setCollapsed] = useState(settings.collapsed); // group keys folded shut
  const [, setTick] = useState(0); // re-render after Settings changes something read straight from `settings`
  const [asking, setAsking] = useState(null); // { title, value, ok(name) }: the small naming dialog
  // First start on a new version: show what changed since the one last seen. A fresh install shows nothing.
  useEffect(() => {
    getVersion().then((v) => {
      const last = store.get("nb.lastVersion", null);
      store.set("nb.lastVersion", v);
      if (last !== v && (last || store.get("nb.setupDone", false))) setWhatsNew({ since: last, current: v });
    }, () => {});
  }, []);
  const showWhatsNew = () => getVersion().then((v) => setWhatsNew({ since: null, current: v }), () => {});
  const [sizes, setSizes] = useState(settings.sizes);
  // set(n) while dragging; set(null) when the drag ends saves what is on screen
  const sizer = (k) => (v) => (v == null ? setSizes((s) => { saveSettings({ sizes: s }); return s; }) : setSizes((s) => ({ ...s, [k]: v })));
  const resetSize = (k) => () => setSizes((s) => { const n = { ...s, [k]: SIZES[k] }; saveSettings({ sizes: n }); return n; });
  const sideHandle = <Resizer axis="x" grow={1} value={sizes.side} min={200} max={() => Math.min(640, window.innerWidth * 0.45)} set={sizer("side")} reset={resetSize("side")} style={{ right: -4 }} />;
  useSyncExternalStore(subscribe, () => reg.version);
  const [updating, setUpdating] = useState(null);
  const tid = useRef(0), toastT = useRef(), revTok = useRef(0);

  const say = useCallback((t, err) => {
    clearTimeout(toastT.current);
    setToast({ t: String(t).split("\n")[0], err });
    toastT.current = setTimeout(() => setToast(null), err ? 5000 : 2400);
  }, []);

  const load = useCallback(async () => {
    try {
      const w = await invoke("load");
      setWf(w);
      setPaths({});
      setActive((a) => (w.repos.some((r) => r.id === a && !r.parked) ? a : w.repos.find((r) => !r.parked)?.id || ""));
    } catch (e) { say(e, true); }
  }, [say]);

  const refresh = useCallback(async (id) => {
    const nr = await invoke("repo", { id }).catch(() => null);
    if (nr) setWf((w) => ({ ...w, repos: w.repos.map((r) => (r.id === id ? nr : r)) }));
    invoke("files", { id }).then((p) => setPaths((ps) => ({ ...ps, [id]: p })), () => {});
  }, []);

  // Runs a git/gh action, reports the outcome, then re-reads the repo.
  const act = async (id, fn, ok) => {
    try { await fn(); if (ok) say(ok); } catch (e) { say(e, true); }
    if (id) await refresh(id);
  };

  useEffect(() => { if (bootError) say(bootError, true); }, [bootError, say]);
  // ponytail: polls GitHub releases every 30 min while open; startup already checked once
  useEffect(() => {
    const t = setInterval(() => checkUpdate(20000).then((u) => u && setUpdate(u)), 30 * 60 * 1000);
    return () => clearInterval(t);
  }, []);
  const runUpdate = async () => {
    setUpdating({ p: 0 });
    try { await install(update, (p) => setUpdating({ p })); } catch (e) { setUpdating(null); say("Update failed: " + e, true); }
  };
  const finishWizard = () => { store.set("nb.setupDone", true); setWizard(false); load(); gh(null, "api", "user", "--jq", ".login").then((u) => setUser(u.trim()), () => {}); };

  useEffect(() => {
    // Each session starts with an empty workfolder; what was out comes back with "Restore last set".
    // ponytail: module flag, not state, so StrictMode's double effect and a remount don't park twice
    const start = !parkedAtStart && settings.startEmpty && store.get("nb.setupDone", false)
      ? invoke("park_all").then((ids) => { if (ids.length) { setLastSet(ids); store.set("nb.lastSet", ids); } }, () => {})
      : Promise.resolve();
    parkedAtStart = true;
    start.then(load);
    gh(null, "api", "user", "--jq", ".login").then((u) => setUser(u.trim()), () => {});
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  const repos = wf?.repos || [];
  // Who else touched each GitHub repo in the last week (pushes, PRs, reviews on any branch), from the events feed
  const [others, setOthers] = useState({});
  const remotes = repos.filter((x) => x.remote.includes("/") && !x.worktree).map((x) => x.id + "=" + x.remote).join(" ");
  useEffect(() => {
    if (!user || !remotes) return;
    const jq = '[.[] | {login: .actor.login, at: .created_at, type, action: .payload.action, ref: ((.payload.ref // "") | sub("^refs/heads/"; "")), num: (.payload.number // .payload.pull_request.number // .payload.issue.number)}]';
    const fetchAll = () => remotes.split(" ").forEach((kv) => {
      const [id, remote] = kv.split("=");
      gh(null, "api", `repos/${remote}/events?per_page=100`, "--jq", jq)
        .then((out) => { const list = othersActive(JSON.parse(out), user); setOthers((o) => ({ ...o, [id]: list })); })
        .catch(() => {}); // no gh, no network, or a repo GitHub doesn't know: just no badge
    });
    fetchAll();
    // ponytail: one events call per repo every 10 min; GitHub allows 5000/h
    const t = setInterval(fetchAll, 10 * 60 * 1000);
    return () => clearInterval(t);
  }, [user, remotes]);
  // Keeps ahead/behind right without a manual pull: a quiet fetch of workfolder repos every 10 min
  const liveRemotes = repos.filter((x) => !x.parked && x.remote).map((x) => x.id).join(" ");
  useEffect(() => {
    if (!liveRemotes) return;
    const t = setInterval(() => Promise.allSettled(liveRemotes.split(" ").map((id) => invoke("fetch", { id }))).then(load), 10 * 60 * 1000);
    return () => clearInterval(t);
  }, [liveRemotes, load]);
  const othersBadge = (x) => {
    const o = others[x.id];
    if (!o?.length) return null;
    const today = Date.now() - Date.parse(o[0].at) < 432e5; // 12 h
    const onMine = o.filter((p) => p.branches.includes(x.branch)).map((p) => p.login);
    const behind = x.branches.find((b) => b.name === x.branch && !b.remote)?.behind > 0;
    const warn = onMine.length > 0 && behind;
    const lines = o.map((p) => `${p.login} ${p.what} (${ago(p.at)})`);
    if (onMine.length) lines.unshift(`${onMine.join(", ")} pushed to ${x.branch}, your branch${behind ? ": pull before you commit" : ""}`, "");
    return (
      <span className="linkish" title={lines.join("\n") + "\n\nClick to open activity on GitHub"}
        onClick={(e) => { e.stopPropagation(); invoke("open_url", { url: `https://github.com/${x.remote}/activity` }).catch((err) => say(err, true)); }}
        style={{ fontSize: 11, color: warn ? "var(--mod)" : today ? "var(--acc-soft)" : "var(--dim)", display: "flex", alignItems: "center", gap: 3, whiteSpace: "nowrap" }}>
        <I n={warn ? "ph-warning" : "ph-users"} />{o.length}{warn ? " on your branch" : today && " today"}
      </span>
    );
  };
  const live = repos.filter((x) => !x.parked), parked = repos.filter((x) => x.parked);
  const r = live.find((x) => x.id === active) || live[0] || EMPTY;
  const cur = r.branches.find((b) => b.name === r.branch) || { ahead: 0, behind: 0 };
  const root = wf?.root || "~/work";
  const openRepo = open && repos.find((x) => x.id === open.repo);
  const openChange = openRepo?.changes.find((c) => c.path === open.path);
  const fileChanged = !!openChange;

  useEffect(() => {
    if (r.id && !paths[r.id]) invoke("files", { id: r.id }).then((p) => setPaths((ps) => ({ ...ps, [r.id]: p })), () => {});
  }, [r.id, paths]);

  useEffect(() => {
    if (!open) return;
    let dead = false;
    Promise.allSettled([
      invoke("read_file", { id: open.repo, path: open.path }),
      openChange ? invoke("diff", { id: open.repo, path: open.path }) : Promise.resolve(""),
    ]).then(([t, d]) => !dead && setDoc({ text: t.value ?? "", err: t.reason ? String(t.reason) : "", diff: d.value || "" }));
    return () => { dead = true; };
  }, [open, wf]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPRs = useCallback(async (id, quiet) => {
    try {
      const list = JSON.parse(await gh(id, "pr", "list", "--state", "all", "--limit", "30", "--json", PR_FIELDS)).map(mapPR);
      setPrs((p) => ({ ...p, [id]: list }));
    }
    catch (e) { setPrs((p) => ({ ...p, [id]: [] })); if (!quiet) say(e, true); }
  }, [say]);
  // loaded quietly for the active repo too, so the rail can show how many PRs are open
  useEffect(() => { if (r.id && (panel === "prs" || r.remote) && !prs[r.id]) loadPRs(r.id, panel !== "prs"); }, [panel, r.id, r.remote, prs, loadPRs]);
  // with several GitHub repos in the workspace the panel lists all of them, grouped by repo
  // (worktrees share their repo's PRs, so they are left out)
  const ghLive = live.filter((x) => x.remote && !x.worktree);
  const prRepos = ghLive.length > 1 ? ghLive.sort((a, b) => a.id.localeCompare(b.id)) : r.id ? [r] : [];
  const issuesAsked = useRef(new Set()); // repos whose issues were fetched (or are being), so the effect below asks once
  const loadIssues = useCallback(async (id, quiet) => {
    issuesAsked.current.add(id);
    try { const list = JSON.parse(await gh(id, "issue", "list", "--state", "all", "--limit", "30", "--json", ISSUE_FIELDS)).map(mapIssue); setIssues((s) => ({ ...s, [id]: list })); }
    catch (e) { setIssues((s) => ({ ...s, [id]: [] })); if (!quiet) say(e, true); }
  }, [say]);
  // loaded even with the panel closed so the rail badge can sum open PRs across the workspace
  useEffect(() => { for (const x of prRepos) if (!prs[x.id]) loadPRs(x.id, true); }, [prRepos.map((x) => x.id).join(" "), prs, loadPRs]); // eslint-disable-line react-hooks/exhaustive-deps
  // issues the same way, from the same repos (worktrees left out)
  useEffect(() => { for (const x of prRepos) if (x.remote && !issuesAsked.current.has(x.id)) loadIssues(x.id, true); }, [prRepos.map((x) => x.id).join(" "), loadIssues]); // eslint-disable-line react-hooks/exhaustive-deps

  const setPanel = (p) => setPanelRaw((cur) => { const n = cur === p ? null : p; if (n) lastPanel.current = n; return n; });
  const openFile = (repo, path, v, line) => { setOpen({ repo, path, line }); setView(v); setActive(repo); setOpenPR(null); setOpenIssue(null); setReportOpen(false); };
  const showOv = (name) => { setOv(name); setQ(""); setPIdx(0); };

  // ---- git actions ----
  const push = () => act(r.id, () => git(r.id, "push", "-u", "origin", "HEAD"), "Pushed to origin/" + r.branch);
  const pull = () => act(r.id, () => git(r.id, "pull", "--ff-only"), "Pulled origin/" + r.branch);
  const staged = r.changes.filter((c) => c.staged), unstaged = r.changes.filter((c) => !c.staged);
  const commit = () => {
    const msg = commitMsg.trim();
    if (!msg || !r.changes.length) return;
    const n = staged.length || r.changes.length;
    act(r.id, async () => {
      if (!staged.length) await git(r.id, "add", "-A");
      await git(r.id, "commit", "-m", msg);
      setCommitMsg("");
      emit("commit", { repo: r.id, branch: r.branch, message: msg });
    }, `Committed ${n} file${n > 1 ? "s" : ""} to ${r.branch}`);
  };
  const stage = (c) => act(r.id, () => (c.staged ? git(r.id, "restore", "--staged", "--", c.path) : git(r.id, "add", "--", c.path)));
  const stageAll = (v) => act(r.id, () => (v ? git(r.id, "add", "-A") : git(r.id, "restore", "--staged", ":/")));
  // runs a branch switch; when uncommitted changes block it, offers to stash them and try again
  const stashAnd = (id, target, fn) => fn().catch(async (e) => {
    if (!/overwritten|stash them/i.test(String(e)) || !window.confirm(`Uncommitted changes in ${id} block switching to ${target}.\n\nStash them and switch? They wait under Stashes on the Changes tab.`)) throw e;
    await git(id, "stash", "push", "-u", "-m", "nimbus: before switching to " + target);
    await fn();
  });
  const switchTo = (id, n) => act(id, () => stashAnd(id, n, () => git(id, "switch", n)), "Switched to " + n);
  const switchBranch = (name) => { setOv(null); switchTo(r.id, name.replace(/^origin\//, "")); };
  const stashCtx = (s) => [
    { icon: "ph-tray-arrow-up", label: "Apply", run: () => act(r.id, () => git(r.id, "stash", "apply", s.sha), "Applied " + s.sha) },
    { icon: "ph-arrow-bend-up-left", label: "Pop (apply and drop)", run: () => act(r.id, () => git(r.id, "stash", "pop", s.sha), "Popped " + s.sha) },
    { sep: true },
    { icon: "ph-trash", label: "Drop", danger: true, run: () => dropStash(s) },
  ];
  const dropStash = (s) => window.confirm(`Drop ${s.sha} (${s.msg})? This cannot be undone.`) && act(r.id, () => git(r.id, "stash", "drop", s.sha), "Dropped " + s.sha);

  // ---- across repos ----
  const search = async () => {
    const s = sq.trim();
    if (!s) return;
    setSearching(true);
    // ponytail: first 20 hits per file and 300 per repo; paging if people search for "the"
    const found = await Promise.all(live.map((x) => git(x.id, "grep", "-n", "-z", "-I", "-i", "-F", "--max-count", "20", x.git ? "--untracked" : "--no-index", "-e", s)
      .then((out) => [x.id, parseGrep(out).slice(0, 300)], () => [x.id, []]))); // exit 1 = no matches
    setHits(Object.fromEntries(found.filter(([, l]) => l.length)));
    setSearchOpen(true);
    setSearching(false);
  };
  const dirtyRepos = live.filter((x) => x.git && x.changes.length);
  const openMulti = () => { setMc((m) => ({ ...m, pick: dirtyRepos.map((x) => x.id) })); showOv("multi"); };
  // One message into every ticked repo, optionally on a shared branch, with PRs that link to each other
  const multiCommit = async () => {
    const msg = mc.msg.trim(), b = mc.branch.trim().replace(/\s+/g, "-"), pick = dirtyRepos.filter((x) => mc.pick.includes(x.id));
    if (!msg || !pick.length) return;
    const onMain = pick.filter((x) => (b || x.branch) === mainOf(x)).map((x) => x.id);
    if (mc.pr && onMain.length) return say(`${onMain.join(", ")} would commit to main; give a branch to open PRs`, true);
    setOv(null);
    const made = [], fails = [];
    for (const x of pick) {
      try {
        if (b && x.branch !== b) await git(x.id, "switch", ...(x.branches.some((y) => !y.remote && y.name === b) ? [] : ["-c"]), b);
        if (!x.changes.some((c) => c.staged)) await git(x.id, "add", "-A");
        await git(x.id, "commit", "-m", msg);
        emit("commit", { repo: x.id, branch: b || x.branch, message: msg });
        if (mc.pr) {
          await git(x.id, "push", "-u", "origin", "HEAD");
          made.push({ id: x.id, url: (await gh(x.id, "pr", "create", "--title", msg, "--body", "", "--base", mainOf(x))).trim().split("\n").pop() });
        }
      } catch (e) { fails.push(`${x.id}: ${String(e).split("\n")[0]}`); }
    }
    if (made.length > 1) await Promise.allSettled(made.map((m) => gh(m.id, "pr", "edit", m.url, "--body", "Part of one change across repos:\n" + made.map((o) => `- ${o.url}${o === m ? " (this one)" : ""}`).join("\n"))));
    made.forEach((m) => loadPRs(m.id, true));
    setMc((m) => ({ ...m, msg: "" }));
    await load();
    const ok = pick.length - fails.length;
    say(`Committed in ${ok} repo${ok === 1 ? "" : "s"}` + (made.length ? ` · opened ${made.length} linked PR${made.length > 1 ? "s" : ""}` : "") + (fails.length ? ` · failed: ${fails.join("; ")}` : ""), fails.length > 0);
  };
  // A second branch of a repo side by side: `git worktree add` into the workfolder as <repo>@<branch>
  const addWorktree = async (x, name) => {
    const b = name.trim().replace(/\s+/g, "-");
    if (!b) return;
    const id = `${x.id}@${b.replace(/\//g, "-")}`, path = wf.abs + "/" + id;
    const known = x.branches.some((y) => (y.remote ? y.name.replace(/^[^/]+\//, "") : y.name) === b);
    try { await git(x.id, "worktree", "add", ...(known ? [path, b] : ["-b", b, path])); } catch (e) { return say(e, true); }
    await load(); setActive(id); setPanelRaw("files"); setExpanded(false);
    say(`${b} is checked out in ${root}/${id}` + (known ? "" : ` (new branch from ${x.branch})`));
  };
  const removeWorktree = async (x) => {
    if (!window.confirm(`Remove the worktree ${root}/${x.id}?` + (x.changes.length ? `\n\nIts ${x.changes.length} uncommitted change${x.changes.length > 1 ? "s" : ""} will be lost.` : "") + `\n\nThe branch ${x.branch} stays.`)) return;
    try { await git(x.id, "worktree", "remove", ...(x.changes.length ? ["--force"] : []), wf.abs + "/" + x.id); } catch (e) { return say(e, true); }
    if (open?.repo === x.id) setOpen(null);
    await load(); say("Removed worktree " + x.id);
  };
  const createBranch = () => {
    const n = q.trim().replace(/\s+/g, "-");
    if (!n) return;
    setOv(null);
    act(r.id, () => git(r.id, "switch", "-c", n), `Created ${n} from ${r.branch}`);
  };
  const mainOf = (x) => x.branches.find((b) => !b.remote && (b.name === "main" || b.name === "master"))?.name || "main";
  const switchAllMain = async () => {
    setAllMain(false);
    setOpen(null);
    let n = 0, skipped = 0, failed = 0;
    for (const x of live) {
      const m = mainOf(x), dirty = x.changes.length > 0;
      if (x.branch !== m && dirty && !amStash) { skipped++; continue; }
      try {
        if (x.branch !== m) {
          if (dirty) await git(x.id, "stash", "push", "-u", "-m", "nimbus: switch all to main");
          await git(x.id, "switch", m);
          n++;
        }
        if (amPull) await git(x.id, "pull", "--ff-only");
      } catch { failed++; }
    }
    await load();
    say(`Switched ${n} repo${n === 1 ? "" : "s"} to main` + (skipped ? ` · ${skipped} skipped (uncommitted)` : "") + (failed ? ` · ${failed} failed` : ""), failed > 0);
  };

  // ---- workfolder ----
  const park = async (id, parkIt) => {
    try { await invoke("set_parked", { id, parked: parkIt }); } catch (e) { return say(e, true); }
    setWf((w) => ({ ...w, repos: w.repos.map((x) => (x.id === id ? { ...x, parked: parkIt } : x)) }));
    if (parkIt) {
      if (open?.repo === id) setOpen(null);
      if (active === id) { setActive(live.find((x) => x.id !== id)?.id || ""); setOpenPR(null); }
      setReserveOpen(true);
      say("Moved " + id + " to reserve");
    } else {
      setActive(id); setPanelRaw("files"); setExpanded(false); setOv(null);
      say(`${id} is back in ${root} on ${repos.find((x) => x.id === id)?.branch}`);
    }
  };
  const clone = async (name, fn, label) => {
    if (repos.some((x) => x.id === name)) return park(name, false);
    // the add dialog stays open so you can start more clones; each row shows its own progress
    setUrlVal(""); setCloning((c) => [...c, name]);
    say("Cloning " + label + "…");
    try {
      await invoke("make_root");
      await fn();
      await load();
      setActive(name); setExpanded(false);
      say(`Cloned into ${root}/${name}`);
    } catch (e) { say(e, true); }
    setCloning((c) => c.filter((x) => x !== name));
  };
  const cloneGh = (g) => clone(g.name, () => gh(null, "repo", "clone", `${g.owner}/${g.name}`, g.name), `${g.owner}/${g.name}`);
  const urlParts = urlVal.trim().match(/([\w.-]+)\/([\w.-]+?)(\.git)?\/?$/);
  const cloneUrl = () => urlParts && clone(urlParts[2], () => invoke("clone", { url: urlVal.trim(), name: urlParts[2] }), urlParts[1] + "/" + urlParts[2]);
  const openAdd = () => {
    showOv("add"); setAddTab("github");
    if (ghRepos) return;
    // ponytail: first 200 repos per owner; paginate if someone has more
    const list = (owner) => gh(null, "repo", "list", ...(owner ? [owner] : []), "--limit", "200", "--json", "name,owner,isPrivate,primaryLanguage,pushedAt").then(JSON.parse, () => []);
    gh(null, "org", "list").then((o) => o.split("\n").filter(Boolean), () => [])
      .then((orgs) => Promise.all([list(null), ...orgs.map(list)]))
      .then((all) => setGhRepos(all.flat().map((g) => ({ owner: g.owner.login, name: g.name, meta: [g.isPrivate ? "Private" : "Public", g.primaryLanguage?.name, "updated " + ago(g.pushedAt)].filter(Boolean).join(" · ") }))));
  };

  // ---- pull requests ----
  const prList = prs[r.id] || [];
  const pr = openPR != null && prList.find((p) => p.num === openPR);
  const iss = openIssue && (issues[openIssue.repo] || []).find((i) => i.num === openIssue.num);
  const createPR = () => act(r.id, async () => {
    await git(r.id, "push", "-u", "origin", "HEAD");
    const out = await gh(r.id, "pr", "create", "--fill", "--base", mainOf(r));
    await loadPRs(r.id);
    const num = +out.trim().split("/").pop();
    if (num) { setOpenPR(num); setOpen(null); say("Opened #" + num + " on github.com/" + r.remote); }
  });
  const prAct = (fn, ok, id = r.id) => act(id, async () => { await fn(); await loadPRs(id); }, ok);

  // ---- AI self-review (claude -p, see review in lib.rs) ----
  const runReview = async (scope, opt = {}, rp = r) => {
    if (!rp.id) return;
    if (scope === "changes" && !rp.git) return say(rp.id + " is not a git repository", true);
    const paths = opt.paths || (scope === "file" && open ? [open.path] : scope === "repo" ? [] : rp.changes.map((c) => c.path));
    if (scope !== "repo" && !paths.length) return say("Nothing to review");
    const n = paths.length, changed = scope === "file" && rp.changes.some((c) => c.path === paths[0]);
    const label = opt.label || (scope === "file" ? paths[0].split("/").pop() : scope === "repo" ? "whole repo" : `${n} changed file${n > 1 ? "s" : ""}`);
    const ask = {
      changes: `Review the uncommitted changes in this repository, on branch ${rp.branch}. Changed files:\n${rp.changes.map((c) => `- ${c.path} (${c.staged ? "staged" : "unstaged"}, ${c.status})`).join("\n")}\nRun \`git diff HEAD\` to see them; untracked files have no diff, so read them directly. Review only these changes, using the rest of the code for context. Look for bugs, logic errors, security issues and missing tests.`,
      file: `Review the file ${paths[0]} in this repository` + (changed ? `, focusing on its uncommitted changes (\`git diff HEAD -- ${paths[0]}\`)` : "") + ". Look for bugs, logic errors, security issues and missing tests.",
      repo: "Review this repository as a whole: correctness, security, structure and missing tests. Start from the README and the entry points; do not try to read every file.",
      pr: `Review pull request #${opt.pr} of ${rp.remote}. Run \`gh pr diff ${opt.pr}\` and \`gh pr view ${opt.pr}\`; the branch may not be checked out, so treat files in the working tree as context only. Look for bugs, logic errors, security issues and missing tests.`,
    }[scope];
    const token = ++revTok.current;
    setReview({ scope, opt, label, repo: rp.id, branch: rp.branch, status: "running", paths, findings: [], summary: "", qa: [], session: "" });
    setReportOpen(false); setRevQ(""); setOv(null);
    if (window.innerWidth < 1280) setPanelRaw(null);
    if (opt.stats) setRevStats(opt.stats);
    else if (rp.git && scope !== "repo") git(rp.id, "diff", "HEAD", "--numstat", "--", ...paths).then((out) => setRevStats(Object.fromEntries(out.split("\n").filter(Boolean).map((l) => { const [a, d, f] = l.split("\t"); return [f, { a: +a || 0, d: +d || 0 }]; }))), () => setRevStats({}));
    else setRevStats({});
    if (rp.remote && !prs[rp.id]) loadPRs(rp.id, true);
    try {
      const res = await invoke("review", { id: rp.id, ask });
      if (token !== revTok.current) return;
      setReview((rv) => ({ ...rv, status: "done", summary: res.summary, session: res.session, findings: res.findings.map((f, i) => ({ ...f, id: i, resolved: false })) }));
      if (scope !== "file") { setReportOpen(true); setOpen(null); setOpenPR(null); }
      emit("review", { repo: rp.id, scope, summary: res.summary, findings: res.findings });
    } catch (e) {
      if (token === revTok.current) setReview((rv) => ({ ...rv, status: "error", err: String(e) }));
    }
  };
  const askReview = async () => {
    const question = revQ.trim(), rv = review;
    if (!question || !rv?.session) return;
    setRevQ("");
    const i = rv.qa.length;
    setReview((x) => ({ ...x, qa: [...x.qa, { q: question, a: null }] }));
    const a = await invoke("review_ask", { id: rv.repo, session: rv.session, question }).catch((e) => String(e));
    setReview((x) => x && x.session === rv.session ? { ...x, qa: x.qa.map((y, j) => (j === i ? { ...y, a } : y)) } : x);
  };
  const goFinding = (f) => { const rp = repos.find((x) => x.id === review.repo); openFile(review.repo, f.path, rp?.changes.some((c) => c.path === f.path) ? "diff" : "code"); };
  const revPR = review && (prs[review.repo] || []).find((p) => p.head === review.branch && p.state === "open");

  // ---- context menus ----
  const openCtx = (e, items) => {
    e.preventDefault(); e.stopPropagation();
    items = items.filter(Boolean);
    const n = terms.filter((t) => t.float).length;
    if (n) items = [...items, items.length && { sep: true }, { icon: floatsHidden ? "ph-eye" : "ph-eye-slash", label: floatsHidden ? `Show popped-out terminals (${n})` : "Hide popped-out terminals", hint: "⌃⇧`", run: toggleFloats }].filter(Boolean);
    if (!items.length) return;
    const h = items.filter((i) => !i.sep).length * 28 + items.filter((i) => i.sep).length * 9 + 8;
    setCtx({ x: Math.max(4, Math.min(e.clientX, window.innerWidth - 236)), y: Math.max(4, Math.min(e.clientY, window.innerHeight - h - 8)), items });
  };
  const copy = (t) => navigator.clipboard.writeText(t).then(() => say("Copied " + (t.length > 48 ? t.slice(0, 46) + "…" : t)), (e) => say(e, true));
  const absPath = (id, path) => [wf?.abs, id, path].filter(Boolean).join("/");
  const ghLink = (rp, path) => `https://github.com/${rp.remote}/blob/${rp.branch}/${path}`;
  const termHere = terms.some((x) => x.float) ? { icon: "ph-arrow-square-out", label: "Pop out a terminal here" } : { icon: "ph-terminal", label: "Open terminal here" };
  // with terminals already popped out, a new one pops out too, into the next free cell
  const termIn = (id) => {
    const t = ++tid.current, float = terms.some((x) => x.float) ? placeFloat() : null;
    if (float) setFloatsHidden(false);
    setTerms((ts) => [...ts, { id: t, repo: id, float }]);
    if (!float) { setTermOpen(true); setActive(id); }
  };
  const discard = (rp, c) => {
    if (!window.confirm(`Discard your changes to ${c.path}? This cannot be undone.`)) return;
    act(rp.id, async () => {
      if (c.status === "A") { if (c.staged) await git(rp.id, "rm", "--cached", "-q", "-f", "--", c.path); await git(rp.id, "clean", "-f", "-q", "--", c.path); }
      else await git(rp.id, "restore", "--source=HEAD", "--staged", "--worktree", "--", c.path);
    }, "Discarded changes to " + c.path.split("/").pop());
  };
  const initGit = (id) => act(id, () => git(id, "init", "-q", "-b", "main"), `Initialized git in ${root}/${id}`);
  const publish = (id) => act(id, () => gh(id, "repo", "create", id, "--private", "--source", ".", "--push"), `Published ${id} to GitHub (private)`);
  const unlinkRepo = async (id) => {
    try { await invoke("unlink", { id }); } catch (e) { return say(e, true); }
    if (open?.repo === id) setOpen(null);
    await load(); say(`Removed ${id} from workfolder · folder untouched`);
  };
  const removeRepo = async (x) => {
    const b = x.branches.find((y) => y.name === x.branch);
    const risk = [x.changes.length && `${x.changes.length} uncommitted change${x.changes.length > 1 ? "s" : ""}`, b?.ahead && `${b.ahead} unpushed commit${b.ahead > 1 ? "s" : ""}`].filter(Boolean).join(" and ");
    if (!window.confirm(`Delete ${root}/${x.id} from disk?` + (risk ? `\n\nIt has ${risk}, which will be lost.` : x.src ? "\n\nOnly the link is removed; the folder stays." : "\n\nIt stays on GitHub if it was pushed."))) return;
    try { await invoke("remove_repo", { id: x.id }); } catch (e) { return say(e, true); }
    await load(); say("Removed " + x.id + (x.remote ? " · still on GitHub" : ""));
  };
  // ---- your own reserve groups ----
  const setGroups = (g) => { setGroupsState(g); saveSettings({ groups: g }); };
  const groupOf = (id) => groups.find((g) => g.repos.includes(id));
  const moveToGroup = (id, name) => setGroups(groups.map((g) => ({ ...g, repos: g.name === name ? [...g.repos.filter((x) => x !== id), id] : g.repos.filter((x) => x !== id) })));
  const nameOk = (name, was) => {
    const n = name.trim();
    if (!n) return null;
    if (n !== was && groups.some((g) => g.name === n)) { say(`There is already a group called ${n}`, true); return null; }
    return n;
  };
  const newGroup = (repo) => setAsking({ title: "New group", value: "", ok: (name) => {
    const n = nameOk(name);
    if (!n) return;
    setGroups([...groups.map((x) => ({ ...x, repos: x.repos.filter((y) => y !== repo) })), { name: n, repos: repo ? [repo] : [] }]);
    setReserveOpen(true);
    say(repo ? `Moved ${repo} to ${n}` : `Created ${n}`);
  } });
  const renameGroup = (name) => setAsking({ title: "Rename group", value: name, ok: (v) => {
    const n = nameOk(v, name);
    if (!n || n === name) return;
    setGroups(groups.map((g) => (g.name === name ? { ...g, name: n } : g)));
  } });
  const deleteGroup = (name) => { setGroups(groups.filter((g) => g.name !== name)); say(`Removed group ${name}; its repos are back in the usual lists`); };
  const toggleCollapsed = (key) => setCollapsed((c) => { const n = c.includes(key) ? c.filter((k) => k !== key) : [...c, key]; saveSettings({ collapsed: n }); return n; });
  const groupItems = (x) => {
    const mine = groupOf(x.id);
    return [
      { sep: true },
      ...groups.filter((g) => g !== mine).map((g) => ({ icon: "ph-folder-simple-star", label: `Move to ${g.name}`, run: () => { moveToGroup(x.id, g.name); say(`Moved ${x.id} to ${g.name}`); } })),
      mine && { icon: "ph-folder-simple-minus", label: `Take out of ${mine.name}`, run: () => moveToGroup(x.id, null) },
      { icon: "ph-folder-simple-plus", label: "New group…", run: () => newGroup(x.id) },
    ];
  };

  const parkAll = async () => {
    const ids = live.map((x) => x.id);
    if (!ids.length) return;
    for (const id of ids) await invoke("set_parked", { id, parked: true }).catch(() => {});
    setLastSet(ids); store.set("nb.lastSet", ids);
    setOpen(null); setOpenPR(null); setReview(null); setReportOpen(false); setAllMain(false); setReserveOpen(true);
    await load(); say(`Moved ${ids.length} repo${ids.length > 1 ? "s" : ""} to reserve`);
  };
  const restoreSet = async () => {
    for (const id of lastSet) await invoke("set_parked", { id, parked: false }).catch(() => {});
    await load(); setActive(lastSet[0]); setPanelRaw("files");
    say(`Restored ${lastSet.length} repo${lastSet.length > 1 ? "s" : ""} to ${root}`);
    setLastSet([]); store.set("nb.lastSet", []);
  };
  const addLocal = async (path) => {
    try {
      const name = await invoke("link", { path });
      setOv(null); await load(); setActive(name); setPanelRaw("files"); setExpanded(false); setLocalDirs(null);
      say(`Linked ${path.replace(/^\/home\/[^/]+/, "~")} into ${root}`);
    } catch (e) { say(e, true); }
  };
  const chooseFolder = async () => { const p = await pickFolder({ directory: true }).catch(() => null); if (p) addLocal(p); };
  const showAddTab = (t) => { setAddTab(t); if (t === "local" && !localDirs) invoke("local_dirs").then(setLocalDirs, () => setLocalDirs([])); };

  const reveal = (id, path = "") => invoke("reveal", { id, path }).catch((e) => say(e, true));
  const pluginItems = (where, ctx) => {
    const items = reg.menus[where].map((m) => ({ icon: m.icon || "ph-puzzle-piece", label: m.label, run: () => Promise.resolve().then(() => m.run(ctx)).catch((e) => say(`${m.plugin}: ${e}`, true)) }));
    return items.length ? [{ sep: true }, ...items] : [];
  };
  const repoCtx = (x) => {
    const sel = () => { setActive(x.id); setOpenPR(null); };
    if (!x.git) return [
      { icon: "ph-git-commit", label: "Initialize git repository", run: () => initGit(x.id) },
      { ...termHere, run: () => termIn(x.id) },
      { sep: true },
      { icon: "ph-copy", label: "Copy path", run: () => copy(x.src || absPath(x.id)) },
      { icon: "ph-folder-open", label: "Open containing folder", run: () => reveal(x.id) },
      { sep: true },
      { icon: "ph-arrow-line-down", label: "Move to reserve", run: () => park(x.id, true) },
      x.src && { icon: "ph-link-break", label: "Remove from workfolder", danger: true, run: () => unlinkRepo(x.id) },
      ...groupItems(x),
      ...pluginItems("repo", { repo: x.id }),
    ];
    return [
      !x.remote && { icon: "ph-cloud-arrow-up", label: "Publish to GitHub", run: () => publish(x.id) },
      !x.remote && { sep: true },
      { ...termHere, run: () => termIn(x.id) },
      { icon: "ph-sparkle", label: "Review changes with AI", disabled: !x.changes.length, run: () => { sel(); runReview("changes", {}, x); } },
      { sep: true },
      { icon: "ph-git-branch", label: "Switch branch…", hint: K + SH + "B", run: () => { sel(); showOv("branch"); } },
      { icon: "ph-arrow-u-up-left", label: "Switch to main", disabled: x.branch === mainOf(x), run: () => switchTo(x.id, mainOf(x)) },
      x.worktree ? { icon: "ph-git-fork", label: "Remove worktree", danger: true, run: () => removeWorktree(x) }
        : { icon: "ph-git-fork", label: "Open another branch side by side…", run: () => setAsking({ title: `Worktree of ${x.id}: branch to check out`, placeholder: "Branch (new or existing)", value: "", ok: (b) => addWorktree(x, b) }) },
      { icon: "ph-arrow-down", label: "Pull", run: () => act(x.id, () => git(x.id, "pull", "--ff-only"), "Pulled origin/" + x.branch) },
      { icon: "ph-arrow-up", label: "Push", disabled: !x.remote, run: () => act(x.id, () => git(x.id, "push", "-u", "origin", "HEAD"), "Pushed to origin/" + x.branch) },
      { sep: true },
      { icon: "ph-copy", label: "Copy path", run: () => copy(x.src || absPath(x.id)) },
      { icon: "ph-folder-open", label: "Open containing folder", run: () => reveal(x.id) },
      { icon: "ph-github-logo", label: "Open on GitHub", disabled: !x.remote, run: () => gh(x.id, "browse").catch((e) => say(e, true)) },
      { sep: true },
      { icon: "ph-arrow-line-down", label: "Move to reserve", run: () => park(x.id, true) },
      { icon: "ph-tray-arrow-down", label: "Move all to reserve", run: parkAll },
      x.src && { icon: "ph-link-break", label: "Remove from workfolder", danger: true, run: () => unlinkRepo(x.id) },
      ...groupItems(x),
      ...pluginItems("repo", { repo: x.id }),
    ];
  };
  const reserveCtx = (x) => [
    { icon: "ph-arrow-line-up", label: "Add to workfolder", run: () => park(x.id, false) },
    { icon: "ph-github-logo", label: "Open on GitHub", disabled: !x.remote, run: () => gh(x.id, "browse").catch((e) => say(e, true)) },
    ...groupItems(x),
    { sep: true },
    x.src ? { icon: "ph-link-break", label: "Remove from workfolder", danger: true, run: () => unlinkRepo(x.id) }
      : { icon: "ph-trash", label: "Remove from disk", danger: true, run: () => removeRepo(x) },
  ];
  const fileCtx = (rp, path) => {
    const c = rp.changes.find((y) => y.path === path);
    return [
      { icon: "ph-file", label: "Open", run: () => openFile(rp.id, path, "code") },
      c && { icon: "ph-git-diff", label: "Open diff", run: () => openFile(rp.id, path, "diff") },
      { icon: "ph-sparkle", label: "Review file with AI", run: () => { openFile(rp.id, path, c ? "diff" : "code"); runReview("file", { paths: [path] }, rp); } },
      c && { sep: true },
      c && { icon: c.staged ? "ph-minus-square" : "ph-plus-square", label: c.staged ? "Unstage" : "Stage", run: () => act(rp.id, () => (c.staged ? git(rp.id, "restore", "--staged", "--", path) : git(rp.id, "add", "--", path))) },
      c && { icon: "ph-arrow-counter-clockwise", label: "Discard changes", danger: true, run: () => discard(rp, c) },
      { sep: true },
      { icon: "ph-copy", label: "Copy path", run: () => copy(path) },
      rp.remote && { icon: "ph-link", label: "Copy GitHub link", run: () => copy(ghLink(rp, path)) },
      { icon: "ph-folder-open", label: "Open containing folder", run: () => reveal(rp.id, path) },
      ...pluginItems("file", { repo: rp.id, path }),
    ];
  };
  const showPR = (num, id = r.id) => { setActive(id); setOpenPR(num); setOpen(null); setReportOpen(false); setOpenIssue(null); };
  const showIssue = (num, id) => { setActive(id); setOpenIssue({ repo: id, num }); setOpenPR(null); setOpen(null); setReportOpen(false); };
  const issueAct = (id, fn, ok) => act(id, async () => { await fn(); await loadIssues(id); }, ok);
  const issueCtx = (i, id) => [
    { icon: "ph-circle-dashed", label: "Open", run: () => showIssue(i.num, id) },
    { icon: "ph-git-branch", label: "Start a branch for it", run: () => act(id, () => stashAnd(id, "a branch for #" + i.num, () => gh(id, "issue", "develop", String(i.num), "--checkout")), `Started a branch for #${i.num}`) },
    { icon: "ph-github-logo", label: "Open on GitHub", run: () => gh(id, "issue", "view", String(i.num), "--web").catch((e) => say(e, true)) },
    { icon: "ph-link", label: "Copy link", run: () => copy(i.url) },
    { sep: true },
    i.state === "open" ? { icon: "ph-check-circle", label: "Close issue", run: () => issueAct(id, () => gh(id, "issue", "close", String(i.num)), `Closed #${i.num}`) }
      : { icon: "ph-arrow-counter-clockwise", label: "Reopen issue", run: () => issueAct(id, () => gh(id, "issue", "reopen", String(i.num)), `Reopened #${i.num}`) },
  ];
  const prCtx = (p, rp = r) => [
    { icon: "ph-git-pull-request", label: "Open", run: () => showPR(p.num, rp.id) },
    { icon: "ph-git-branch", label: "Check out branch", run: () => act(rp.id, () => stashAnd(rp.id, p.head, () => gh(rp.id, "pr", "checkout", String(p.num))), "Switched to " + p.head) },
    { icon: "ph-sparkle", label: "Review PR with AI", run: () => runReview("pr", { pr: p.num, paths: p.files.map((f) => f.path), label: "PR #" + p.num, stats: Object.fromEntries(p.files.map((f) => [f.path, { a: f.adds, d: f.dels }])) }, rp) },
    { icon: "ph-github-logo", label: "Open on GitHub", run: () => gh(rp.id, "pr", "view", String(p.num), "--web").catch((e) => say(e, true)) },
    p.state === "open" && { sep: true },
    p.state === "open" && { icon: "ph-git-merge", label: "Squash and merge", run: () => prAct(() => gh(rp.id, "pr", "merge", String(p.num), "--squash"), `Merged #${p.num} into ${p.base}`, rp.id) },
  ];
  const editorCtx = () => {
    if (!open) return [];
    const rp = repos.find((x) => x.id === open.repo) || EMPTY;
    return [
      { icon: "ph-sparkle", label: "Review file with AI", run: () => runReview("file", { paths: [open.path] }, rp) },
      fileChanged && { icon: v === "diff" ? "ph-code" : "ph-git-diff", label: v === "diff" ? "Show code" : "Show diff", run: () => setView(v === "diff" ? "code" : "diff") },
      { sep: true },
      { icon: "ph-copy", label: "Copy path", run: () => copy(open.path) },
      rp.remote && { icon: "ph-link", label: "Copy GitHub link", run: () => copy(ghLink(rp, open.path)) },
      { icon: "ph-folder-open", label: "Open containing folder", run: () => reveal(open.repo, open.path) },
      { ...termHere, run: () => termIn(open.repo) },
      ...pluginItems("editor", { repo: open.repo, path: open.path }),
      { sep: true },
      { icon: "ph-x", label: "Close file", run: () => setOpen(null) },
    ];
  };

  // ---- terminal ----
  // Each repo keeps its own docked terminals (and shell history, see spawn_shell): switching repo swaps the
  // bottom panel to that repo's shells, the others keep running out of sight. Popped-out ones always show.
  const mine = (t) => !t.repo || t.repo === r.id;
  const newTerm = (cmd, repo) => {
    const id = ++tid.current;
    if (repo && live.some((x) => x.id === repo)) setActive(repo);
    setTerms((t) => [...t, { id, repo: repo ?? (live.length ? r.id : null), cmd: typeof cmd === "string" ? cmd : "" }]);
    setTermOpen(true); setOv(null);
  };
  // Ctrl+` shows or hides the docked terminals; popped-out ones stay where they are
  const toggleTerm = () => (terms.some((t) => !t.float && mine(t)) ? setTermOpen((o) => !o) : newTerm());
  const closeTerm = (id) => setTerms((ts) => {
    const rest = ts.filter((t) => t.id !== id);
    if (!rest.some((t) => !t.float)) setTermOpen(false);
    return rest;
  });
  // A terminal's `float` is null while docked, or { x, y, w, h, z, hue } while popped out over the app
  const zTop = useRef(0);
  const setFloat = (id, float) => setTerms((ts) => ts.map((t) => (t.id === id ? { ...t, float } : t)));
  /** The editor area, where popped-out terminals snap: the sidebar and review panel stay uncovered. */
  const termArea = () => {
    const q = document.getElementById("term-area")?.getBoundingClientRect();
    return q ? { x: q.x, y: q.y, w: q.width, h: q.height } : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight - 26 };
  };
  const inArea = (c, a) => ({ ...c, x: c.x + a.x, y: c.y + a.y });
  /** Snap target for the pointer at (cx, cy) in page coordinates; see snapZone. */
  const zoneAt = (cx, cy) => {
    const a = termArea(), z = snapZone(cx - a.x, cy - a.y, a.w, a.h, settings.termGrid, 0);
    return z && z !== "dock" ? inArea(z, a) : z;
  };
  /** Where a newly popped-out terminal goes: the first grid cell no snapped terminal holds, else the middle of the editor area. */
  const placeFloat = () => {
    const a = termArea(), m = /^(\d+)x(\d+)$/.exec(settings.termGrid);
    const held = [...document.querySelectorAll("[data-snapped]")].map((el) => { const q = el.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; });
    const base = { z: ++zTop.current, hue: nextHue() };
    if (m) {
      const [cols, rows] = [+m[1], +m[2]];
      for (let i = 0; i < cols * rows; i++) {
        const c = inArea(cellRect(i % cols, Math.floor(i / cols), cols, rows, a.w, a.h), a);
        if (!held.some((o) => overlaps(c, o))) return { ...c, ...base, snapped: true };
      }
    }
    const n = terms.filter((x) => x.float && !x.float.snapped).length, w = Math.min(720, a.w - 16), h = Math.min(360, a.h - 16);
    return { x: Math.round(a.x + (a.w - w) / 2 + n * 28), y: Math.round(a.y + (a.h - h) / 2 + n * 28), w, h, ...base };
  };
  const popOut = (t) => { setFloat(t.id, placeFloat()); setFloatsHidden(false); };
  // Ctrl+Shift+` or any right-click menu: tuck every popped-out terminal away (shells keep running) and bring them back
  const [floatsHidden, setFloatsHidden] = useState(false);
  const toggleFloats = () => (terms.some((t) => t.float) ? setFloatsHidden((h) => !h) : say("No popped-out terminals"));
  const dock = (t) => { setFloat(t.id, null); setTermOpen(true); if (live.some((x) => x.id === t.repo)) setActive(t.repo); };
  // random first colour, then a golden-angle step so windows open side by side never look alike
  const lastHue = useRef(Math.random() * 360);
  const nextHue = () => (lastHue.current = (lastHue.current + 137.5) % 360);
  // where a dragged terminal would land: a snap rectangle, "dock", or null
  const [snap, setSnap] = useState(null);
  /** Title bar drag: pulling a docked terminal up pops it out; dropping a popped-out one on an edge or corner snaps it (see snapZone), on the bottom edge docks it. */
  const dragPane = (e, t) => {
    if (e.button !== 0 || e.target.closest(".ib")) return;
    const bar = e.currentTarget, pane = bar.parentElement, r = pane.getBoundingClientRect();
    const grab = { x: e.clientX - r.left, y: e.clientY - r.top }, startY = e.clientY;
    let f = t.float && { ...t.float, z: ++zTop.current };
    // a snap target already held by another snapped terminal is off limits (measured live: they may have been resized);
    // terminals floating freely don't hold a spot, so snapping may cover them
    const others = [...document.querySelectorAll("[data-snapped]")].filter((el) => el.dataset.snapped !== String(t.id)).map((el) => { const q = el.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; });
    const zone = (ev) => {
      const z = zoneAt(ev.clientX, ev.clientY);
      return z && z !== "dock" && others.some((o) => overlaps(z, o)) ? { ...z, blocked: true } : z;
    };
    if (f) setFloat(t.id, f);
    bar.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (!f) {
        if (startY - ev.clientY < 30) return;
        f = { w: 720, h: Math.max(Math.round(r.height), 240), z: ++zTop.current, hue: nextHue() };
        setFloatsHidden(false);
        grab.x = Math.round(f.w * grab.x / r.width); grab.y = 14; // keep the pointer over the same spot of the title bar
      }
      f = { ...f, x: Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - grab.x)), y: Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - grab.y)) };
      setFloat(t.id, f);
      setSnap(zone(ev));
    };
    const up = (ev) => {
      bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up);
      setSnap(null);
      if (!f) return;
      const p = pane.getBoundingClientRect(), z = zone(ev);
      if (z === "dock") dock(t);
      else if (z?.blocked) setFloat(t.id, t.float ? { ...t.float, z: f.z } : { ...f, w: Math.round(p.width), h: Math.round(p.height) }); // back where it came from
      else setFloat(t.id, { ...f, w: Math.round(p.width), h: Math.round(p.height), ...z, snapped: !!z });
    };
    bar.addEventListener("pointermove", move); bar.addEventListener("pointerup", up);
  };
  // ponytail: re-read git state shortly after each Enter in a shell; a file watcher would be exact
  const termEnter = (repo) => { if (repo) setTimeout(() => refresh(repo), 1200); };

  // ---- palette ----
  const paletteItems = () => {
    const pq = q.trim().toLowerCase();
    const go = (f) => () => { setOv(null); f(); };
    const cmds = [
      { icon: "ph-terminal", label: "New terminal", hint: "⌃`", run: go(newTerm) },
      { icon: "ph-arrow-u-up-left", label: "Switch all repos to main…", run: go(() => { setPanelRaw("files"); setAllMain(true); }) },
      { icon: "ph-git-branch", label: "Switch branch…", hint: K + SH + "B", run: () => showOv("branch") },
      { icon: "ph-github-logo", label: "Add repo or folder…", hint: K + "O", run: openAdd },
      { icon: "ph-git-diff", label: "Show changes", hint: K + "2", run: go(() => setPanelRaw("git")) },
      { icon: "ph-git-pull-request", label: "Pull requests", hint: K + "3", run: go(() => setPanelRaw("prs")) },
      { icon: "ph-circle-dashed", label: "Issues", hint: K + "4", run: go(() => setPanelRaw("issues")) },
      { icon: "ph-magnifying-glass", label: "Search all repos", hint: K + SH + "F", run: go(() => setTimeout(() => searchBox.current?.select())) },
      { icon: "ph-stack", label: "Commit across repos…", run: go(openMulti) },
      { icon: "ph-keyboard", label: "Keyboard shortcuts", hint: K + "/", run: () => showOv("keys") },
      { icon: "ph-arrow-up", label: "Push", run: go(push) },
      { icon: "ph-arrow-down", label: "Pull", run: go(pull) },
      { icon: "ph-sidebar-simple", label: "Toggle sidebar", hint: K + "\\", run: go(() => setPanelRaw((p) => (p ? null : lastPanel.current))) },
      { icon: "ph-sparkle", label: "Review changes with AI", hint: K + SH + "R", run: go(() => runReview("changes")) },
      { icon: "ph-sparkle", label: "Review whole repo with AI", run: go(() => runReview("repo")) },
      { icon: "ph-tray-arrow-down", label: "Move all repos to reserve", run: go(parkAll) },
      { icon: "ph-folder-plus", label: "Add local folder…", run: () => { showOv("add"); showAddTab("local"); } },
      { icon: "ph-arrows-clockwise", label: "Reload workfolder", run: go(load) },
      { icon: "ph-gear-six", label: "Settings", hint: K + ",", run: go(() => setSettingsOpen(true)) },
      { icon: "ph-confetti", label: "What's new", run: go(showWhatsNew) },
      ...reg.commands.map((c) => ({ icon: c.icon || "ph-puzzle-piece", label: c.label, sub: c.plugin, hint: c.hint, run: go(() => Promise.resolve().then(c.run).catch((e) => say(`${c.plugin}: ${e}`, true))) })),
    ];
    const files = live.flatMap((x) => (paths[x.id] || []).map((p) => ({ icon: "ph-file", label: p.split("/").pop(), sub: x.id + "/" + p, run: go(() => openFile(x.id, p, "code")) })));
    const m = (x) => !pq || (x.label + " " + (x.sub || "")).toLowerCase().includes(pq);
    return [...(pq ? files.filter(m) : []), ...cmds.filter(m), ...(pq ? [] : files.slice(0, 3))].slice(0, 10);
  };
  const pItems = ov === "palette" ? paletteItems() : [];
  const pSel = Math.min(pIdx, Math.max(0, pItems.length - 1));
  useEffect(() => { if (ov === "palette") live.forEach((x) => paths[x.id] || invoke("files", { id: x.id }).then((p) => setPaths((ps) => ({ ...ps, [x.id]: p })), () => {})); }, [ov]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- keyboard ----
  const onKey = useRef();
  onKey.current = (e) => {
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (e.key === "Escape") { if (asking) return setAsking(null); setCtx(null); setSettingsOpen(false); setWhatsNew(null); setSearchOpen(false); return setOv(null); }
    if (e.ctrlKey && e.code === "Backquote") { e.preventDefault(); return e.shiftKey ? toggleFloats() : toggleTerm(); }
    if (e.target.closest?.(".xterm")) return; // everything else belongs to the shell
    if (!mod) return;
    const hit = { k: () => (ov === "palette" ? setOv(null) : showOv("palette")), 1: () => setPanel("files"), 2: () => setPanel("git"), 3: () => setPanel("prs"), 4: () => setPanel("issues"), "\\": () => setPanelRaw((p) => (p ? null : lastPanel.current)), o: openAdd, ",": () => setSettingsOpen(true) }[k];
    // "/" is Shift+7 on some layouts, so shift is fine here; "?" covers Shift+/ on US ones
    if (k === "/" || k === "?") { e.preventDefault(); ov === "keys" ? setOv(null) : showOv("keys"); }
    else if (e.shiftKey && k === "f") { e.preventDefault(); searchBox.current?.select(); if (hits) setSearchOpen(true); }
    else if (e.shiftKey && k === "b") { e.preventDefault(); showOv("branch"); }
    else if (e.shiftKey && k === "r") { e.preventDefault(); runReview("changes"); }
    else if (hit && !e.shiftKey) { e.preventDefault(); hit(); }
  };
  useEffect(() => { const h = (e) => onKey.current(e); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, []);

  // ---- editor body (memoized: re-tokenizing a big file on every keystroke is noticeable) ----
  const hunks = useMemo(() => parseDiff(doc.diff), [doc.diff]);
  const flagKey = review?.status === "done" && open && review.repo === open.repo
    ? review.findings.filter((f) => f.path === open.path && !f.resolved).map((f) => f.line + ":" + f.severity).join(",") : "";
  const flags = useMemo(() => Object.fromEntries(flagKey.split(",").filter(Boolean).map((x) => { const [l, sv] = x.split(":"); return [l, SEV[sv].c]; })), [flagKey]);
  const flag = (n) => (flags[n] ? `inset 2px 0 0 ${flags[n]}` : undefined);
  const v = fileChanged ? view : "code", hl = open?.line;
  const body = useMemo(() => {
    if (v === "code") {
      if (doc.err) return <div style={{ padding: "24px 20px", color: "var(--dim)" }}>{doc.err}</div>;
      // ponytail: renders every line; virtualize if 10k+ line files matter
      return (
        <div className="code" style={{ padding: "14px 0 40px" }}>
          {doc.text.split("\n").map((l, i) => (
            <div className="line" key={i} style={{ boxShadow: flag(i + 1), background: i + 1 === hl ? "color-mix(in srgb, var(--acc) 14%, transparent)" : undefined }}><span className="ln" style={{ width: 60, paddingRight: 24 }}>{i + 1}</span><span className="pre"><Toks code={l} /></span></div>
          ))}
        </div>
      );
    }
    const bg = (k) => (k === "+" ? ADD_BG : k === "-" ? DEL_BG : k === "x" ? EMPTY_BG : "transparent");
    if (diffStyle === "unified") return (
      <div className="code" style={{ padding: "4px 0 40px" }}>
        {hunks.map((h, hi) => [
          <div className="hunk" key={"h" + hi}>{h.header}</div>,
          ...h.rows.map((d, i) => (
            <div className="line" key={hi + ":" + i} style={{ background: bg(d.sign), boxShadow: d.sign === "-" ? undefined : flag(d.n) }}>
              <span className="ln" style={{ width: 44 }}>{d.o}</span>
              <span className="ln" style={{ width: 44 }}>{d.n}</span>
              <span style={{ width: 28, flex: "none", textAlign: "center", userSelect: "none", color: d.sign === "+" ? ST.A : ST.D }}>{d.sign.trim()}</span>
              <span className="pre"><Toks code={d.code} /></span>
            </div>
          )),
        ])}
      </div>
    );
    const side = (s, border) => (
      <div style={{ display: "flex", overflow: "hidden", background: bg(s.k), borderRight: border ? "1px solid color-mix(in srgb, var(--fg) 5%, transparent)" : 0, boxShadow: border ? undefined : flag(s.n) }}>
        <span className="ln" style={{ width: 44, paddingRight: 14 }}>{s.n}</span>
        <span className="pre"><Toks code={s.code} /></span>
      </div>
    );
    return (
      <div className="code" style={{ fontSize: "calc(var(--code-size) - 0.5px)", padding: "4px 0 40px" }}>
        {hunks.map((h, hi) => [
          <div className="hunk" key={"h" + hi}>{h.header}</div>,
          ...splitRows(h.rows).map((d, i) => (
            <div key={hi + ":" + i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", minHeight: "1.62em" }}>{side(d.l, true)}{side(d.r)}</div>
          )),
        ])}
      </div>
    );
  }, [doc, hunks, v, diffStyle, flags, hl]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (hl && v === "code") document.querySelector(`#term-area .code > .line:nth-child(${hl})`)?.scrollIntoView({ block: "center" }); }, [doc, hl, v]);
  const adds = hunks.reduce((a, h) => a + h.rows.filter((x) => x.sign === "+").length, 0);
  const dels = hunks.reduce((a, h) => a + h.rows.filter((x) => x.sign === "-").length, 0);

  // ---- plugin host: what nimbus.state(), .openFile(), .terminal() and .toast() reach ----
  Object.assign(host, {
    state: () => ({ root, repo: r.id ? { id: r.id, branch: r.branch, remote: r.remote, git: r.git, changes: r.changes } : null, file: open }),
    openFile: (repo, path) => openFile(repo, path, repos.find((x) => x.id === repo)?.changes.some((c) => c.path === path) ? "diff" : "code"),
    terminal: (cmd, repo) => newTerm(cmd, repo),
    toast: say,
  });
  useEffect(() => { if (r.id) emit("repo", host.state().repo); }, [r.id, r.branch]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) emit("file", open); }, [open]);
  useEffect(() => {
    if (r.id) setUsed((u) => { const n = { ...u, [r.id]: Date.now() }; store.set("nb.used", n); return n; });
  }, [r.id]);

  if (!wf) return <div className="app" />;

  // ---- render pieces ----
  const hasRepos = live.length > 0;
  // Reserve: the repos you worked in most recently first, then the rest by name
  const rgroups = reserveGroups(parked, { used, lastSet, days: settings.reserveDays, groups });
  const groupHead = (g, style) => g.label && (
    <div key={g.key} className="hov" onClick={() => toggleCollapsed(g.key)}
      onContextMenu={(e) => g.custom ? openCtx(e, [
        { icon: "ph-pencil-simple", label: "Rename group…", run: () => renameGroup(g.label) },
        { icon: "ph-folder-simple-plus", label: "New group…", run: () => newGroup() },
        { sep: true },
        { icon: "ph-trash", label: "Delete group", danger: true, run: () => deleteGroup(g.label) },
      ]) : openCtx(e, [{ icon: "ph-folder-simple-plus", label: "New group…", run: () => newGroup() }, { icon: "ph-sliders-horizontal", label: "Adjust groups…", run: () => setSettingsOpen(true) }])}
      style={{ display: "flex", alignItems: "center", gap: 6, ...style }}>
      <I n={collapsed.includes(g.key) ? "ph-caret-right" : "ph-caret-down"} style={{ fontSize: 9, width: 10 }} />
      {g.custom && <I n="ph-folder-simple-star" style={{ fontSize: 11 }} />}
      <span>{g.label}</span><span style={{ opacity: 0.7 }}>{g.items.length}</span>
    </div>
  );
  const showReport = !!(reportOpen && review?.status === "done" && hasRepos);
  const bInfo = (x) => {
    if (!x.git) return { sync: "", syncColor: "var(--dimmer)", branchColor: "var(--dim)", chipBg: "color-mix(in srgb, var(--fg) 4%, transparent)", chipIcon: "ph-folder-simple-dashed", branchText: "not a repo" };
    const b = x.branches.find((y) => y.name === x.branch) || {};
    const main = x.branch === "main" || x.branch === "master";
    return {
      sync: b.ahead || b.behind ? `↑${b.ahead || 0} ↓${b.behind || 0}` : "synced",
      syncColor: b.ahead || b.behind ? "var(--soft)" : "var(--dimmer)",
      branchColor: main ? "var(--mid)" : "var(--acc-soft)",
      chipBg: main ? "color-mix(in srgb, var(--fg) 5%, transparent)" : "color-mix(in srgb, var(--acc) 12%, transparent)",
      chipIcon: "ph-git-branch", branchText: x.branch,
    };
  };
  const rail = [
    { icon: "ph-files", key: "files", title: `Files  ${K}1`, badge: live.length },
    { icon: "ph-git-diff", key: "git", title: `Changes  ${K}2`, badge: r.changes.length },
    { icon: "ph-git-pull-request", key: "prs", title: `Pull requests  ${K}3`, badge: prRepos.reduce((n, x) => n + (prs[x.id] || []).filter((p) => p.state === "open" || p.state === "draft").length, 0) },
    { icon: "ph-circle-dashed", key: "issues", title: `Issues  ${K}4`, badge: prRepos.reduce((n, x) => n + (issues[x.id] || []).filter((i) => i.state === "open").length, 0) },
  ];
  const seg = (opts) => (
    <div className="seg">{opts.map(([label, on, pick]) => <button key={label} className={on ? "on" : ""} onClick={pick}>{label}</button>)}</div>
  );
  const Check = ({ on, onClick, title }) => <span className={"check" + (on ? " on" : "")} onClick={onClick} title={title}>{on && <I n="ph-check" />}</span>;
  const bq = q.trim().toLowerCase();
  const branchRows = r.branches.filter((b) => !bq || b.name.toLowerCase().includes(bq));
  const commitLabel = !r.changes.length ? "Nothing to commit" : staged.length ? `Commit ${staged.length} staged to ${r.branch}` : `Commit all ${r.changes.length} to ${r.branch}`;
  const amCount = live.filter((x) => x.branch !== mainOf(x) && !(x.changes.length && !amStash)).length;
  const canOpenPR = hasRepos && r.branch && r.branch !== mainOf(r) && !prList.find((p) => p.head === r.branch && p.state === "open");
  const aq = q.trim().toLowerCase();
  const step = (n, title, desc, done, btn, onClick) => ({ n, title, desc, done, btn, onClick });
  const obSteps = [
    step("1", "Connect GitHub", "See your repos, branches and pull requests.", !!user, "Connect", () => setWizard(true)),
    step("2", "Choose a workfolder", `Every repo you add lives side by side in ${root}.`, wf.exists, "Use " + root, () => invoke("make_root").then(load, (e) => say(e, true))),
    step("3", "Add your first repository", "Clone from GitHub or paste any git URL.", false, "Browse repos", openAdd),
  ];

  return (
    // right-click anywhere without its own menu: the hide/show entry for popped-out terminals (openCtx adds it)
    <div className="app" onContextMenu={(e) => { if (!e.target.closest("input, textarea, .xterm")) openCtx(e, []); }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Rail */}
        <div style={{ width: 48, flex: "none", display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 0", gap: 4, borderRight: "1px solid var(--line)" }}>
          {rail.map((it) => (
            <button key={it.key} className="rail" title={it.title} onClick={() => setPanel(it.key)} style={{ color: panel === it.key ? "var(--fg)" : "var(--dim)" }}>
              <I n={it.icon} />
              {panel === it.key && <span style={{ position: "absolute", left: -6, top: 9, bottom: 9, width: 2, borderRadius: 2, background: "var(--acc)" }} />}
              {it.badge > 0 && <span style={{ position: "absolute", top: 5, right: 4, minWidth: 14, height: 14, padding: "0 3px", borderRadius: 7, background: "var(--badge)", color: "var(--acc-ink)", fontSize: 9, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{it.badge}</span>}
            </button>
          ))}
          <div className="spacer" />
          <button className="rail" title={`Settings  ${K},`} onClick={() => setSettingsOpen(true)} style={{ color: "var(--dim)", fontSize: 18 }}><I n="ph-gear-six" /></button>
          <button className="rail" title={`Add repository  ${K}O`} onClick={openAdd} style={{ color: "var(--dim)", fontSize: 18 }}><I n="ph-plus" /></button>
          <div title={user ? "GitHub · " + user : "Not signed in to GitHub"} style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--chip)", color: "var(--acc-fg)", fontSize: 10, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 6, boxShadow: "0 0 0 1px var(--badge)" }}>
            {user ? user.slice(0, 2).toUpperCase() : <I n="ph-user" />}
          </div>
        </div>

        {/* Workfolder */}
        {panel === "files" && (
          <div className="panel" style={{ width: sizes.side }}>
            {sideHandle}
            <div className="head" style={{ gap: 8, padding: "0 10px 0 16px" }}>
              <span className="label">Workfolder</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--dimmer)" }}>{root}</span>
              <div className="spacer" />
              <button className="ib" title="Switch all to main" onClick={() => setAllMain((o) => !o)}><I n="ph-arrow-u-up-left" /></button>
              <button className="ib" title="Move all to reserve" onClick={parkAll}><I n="ph-tray-arrow-down" /></button>
              <button className="ib" title="Add repo or folder" onClick={openAdd}><I n="ph-plus" /></button>
            </div>
            {allMain && (
              <div style={{ margin: "0 10px 10px", padding: 12, borderRadius: 10, background: "var(--pop)", boxShadow: "0 0 0 1px var(--border)", animation: "rise .12s ease-out" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><I n="ph-arrow-u-up-left" style={{ color: "var(--acc)" }} /><span style={{ fontWeight: 500 }}>Switch all to main</span></div>
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  {live.map((x) => {
                    const onMain = x.branch === mainOf(x), dirty = x.changes.length > 0, skip = dirty && !amStash && !onMain;
                    const note = onMain ? "already on main" : skip ? "skipped · uncommitted" : dirty ? `stash ${x.changes.length} change${x.changes.length > 1 ? "s" : ""}` : "clean";
                    return (
                      <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, minWidth: 0 }}>
                        <span style={{ color: onMain ? "var(--dim)" : "var(--fg)", flex: "none" }}>{x.id}</span>
                        {!onMain && <><span className="mono ellip" style={{ fontSize: 10.5, color: "var(--acc-soft)", minWidth: 0 }}>{x.branch}</span><I n="ph-arrow-right" style={{ fontSize: 10, color: "var(--dimmer)", flex: "none" }} /><span className="mono" style={{ fontSize: 10.5, color: "var(--mid)", flex: "none" }}>{mainOf(x)}</span></>}
                        <span className="spacer" />
                        <span style={{ fontSize: 11, whiteSpace: "nowrap", flex: "none", color: onMain ? "var(--dimmer)" : skip || dirty ? "var(--mod)" : "var(--dim)" }}>{note}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                  {[["Stash uncommitted changes", amStash, setAmStash], ["Pull latest main", amPull, setAmPull]].map(([label, on, set]) => (
                    <div key={label} className="linkish" onClick={() => set(!on)} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--soft)" }}><Check on={on} />{label}</div>
                  ))}
                </div>
                <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
                  <button className="btn" style={{ flex: 1, height: 28, borderRadius: 7, fontSize: 12 }} onClick={switchAllMain}>{amCount ? `Switch ${amCount} repo${amCount > 1 ? "s" : ""} to main` : amPull ? "Pull main everywhere" : "Everything is on main"}</button>
                  <button className="ghost" style={{ height: 28, padding: "0 10px", borderRadius: 7, fontSize: 12 }} onClick={() => setAllMain(false)}>Cancel</button>
                </div>
              </div>
            )}
            <div className="scroll">
              {live.map((x) => {
                const isAct = x.id === r.id, ch = Object.fromEntries(x.changes.map((c) => [c.path, c.status])), bi = bInfo(x);
                const isCloning = cloning.includes(x.id);
                return (
                  <div key={x.id} style={{ marginBottom: 2 }}>
                    <div className="hov" onContextMenu={(e) => openCtx(e, repoCtx(x))} onClick={() => { if (isAct) setExpanded((e) => !e); else { setActive(x.id); setExpanded(true); setOpenPR(null); } }}
                      style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 8px 7px 10px", color: isAct ? "var(--fg)" : "var(--soft)", boxShadow: `inset 2px 0 0 ${isAct ? "var(--acc)" : "transparent"}` }}>
                      <I n={isAct && expanded ? "ph-caret-down" : "ph-caret-right"} style={{ fontSize: 11, color: "var(--dimmer)", width: 12, marginTop: 3 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, height: 18 }}>
                          <span className="ellip" style={{ fontWeight: 500 }}>{x.id}</span>
                          {terms.some((t) => t.repo === x.id) && <span title="Has a running terminal" style={{ display: "flex", color: "var(--dimmer)", fontSize: 12 }}><I n="ph-terminal" /></span>}
                          {x.worktree && <span title="Worktree: a second checkout of the same repo" style={{ display: "flex", color: "var(--dimmer)", fontSize: 12 }}><I n="ph-git-fork" /></span>}
                          {isCloning && <I n="ph-circle-notch spin" />}
                          <span className="spacer" />
                          {othersBadge(x)}
                          {x.changes.length > 0 && <span title="Uncommitted changes" style={{ fontSize: 11, color: "var(--mod)", display: "flex", alignItems: "center", gap: 4 }}><span className="dot" />{x.changes.length}</span>}
                        </div>
                        <div className="mono" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 11, minWidth: 0 }}>
                          <span className="chip" style={{ background: bi.chipBg, color: bi.branchColor }}><I n={bi.chipIcon} style={{ fontSize: 11, flex: "none" }} /><span className="ellip">{bi.branchText}</span></span>
                          <span style={{ color: bi.syncColor, whiteSpace: "nowrap", flex: "none" }}>{bi.sync}</span>
                        </div>
                      </div>
                      <button className="ib" title="Move to reserve" onClick={(e) => { e.stopPropagation(); park(x.id, true); }} style={{ width: 22, height: 22, borderRadius: 5, fontSize: 13, color: "var(--dimmer)" }}><I n="ph-arrow-line-down" /></button>
                    </div>
                    {isAct && expanded && buildTree(paths[x.id] || [], (d) => openDirs[x.id + ":" + d]).map((n) => {
                      const isOpen = open && open.repo === x.id && open.path === n.path, st = ch[n.path] || "";
                      const click = n.dir ? () => setOpenDirs((o) => ({ ...o, [x.id + ":" + n.path]: !o[x.id + ":" + n.path] })) : () => openFile(x.id, n.path, "code");
                      return (
                        <div key={n.path} className="hov" onClick={click} onContextMenu={(e) => (n.dir ? e.preventDefault() : openCtx(e, fileCtx(x, n.path)))} style={{ display: "flex", alignItems: "center", gap: 7, height: 26, paddingLeft: 32 + n.depth * 14, paddingRight: 14, background: isOpen ? "color-mix(in srgb, var(--acc) 12%, transparent)" : undefined, color: isOpen ? "var(--fg)" : n.dir ? "var(--mid)" : "var(--soft)" }}>
                          <I n={n.dir ? (openDirs[x.id + ":" + n.path] ? "ph-folder-open" : "ph-folder-simple") : "ph-file"} style={{ fontSize: 13, color: "var(--dimmer)" }} />
                          <span className="ellip" style={{ flex: 1, minWidth: 0 }}>{n.name}</span>
                          <span className="mono" style={{ fontSize: 11, color: ST[st] || "var(--mod)" }}>{st}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {cloning.filter((c) => !repos.some((x) => x.id === c)).map((c) => (
                <div key={c} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px 7px 30px", color: "var(--soft)" }}><span style={{ fontWeight: 500 }}>{c}</span><I n="ph-circle-notch spin" /></div>
              ))}
              <div className="linkish" onClick={openAdd} style={{ display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 12px 0 32px", marginTop: 6, color: "var(--dim)" }}>
                <I n="ph-github-logo" style={{ fontSize: 14 }} /><span>Add repo or folder</span><span style={{ marginLeft: "auto", fontSize: 11, color: "var(--dimmer)" }}>{K}O</span>
              </div>
              {parked.length > 0 && (
                <div style={{ marginTop: 14, paddingTop: 8, borderTop: "1px solid color-mix(in srgb, var(--fg) 5%, transparent)" }}>
                  <div className="hov" onClick={() => setReserveOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 12px 0 10px" }}>
                    <I n={reserveOpen ? "ph-caret-down" : "ph-caret-right"} style={{ fontSize: 11, color: "var(--dimmer)", width: 12 }} />
                    <span className="label">Reserve</span><span style={{ fontSize: 11, color: "var(--dimmer)" }}>{parked.length}</span>
                    {lastSet.length > 0 && lastSet.some((id) => parked.some((x) => x.id === id))
                      ? <span className="linkish" title={lastSet.join(", ")} onClick={(e) => { e.stopPropagation(); restoreSet(); }} style={{ marginLeft: "auto", fontSize: 11, color: "var(--acc-soft)" }}>Restore last set</span>
                      : <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--dimmer)" }}>on disk · hidden</span>}
                  </div>
                  {reserveOpen && rgroups.map((g) => [
                    groupHead(g, { padding: "8px 12px 3px 18px", fontSize: 10.5, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--dimmer)" }),
                    g.custom && !g.items.length && !collapsed.includes(g.key) && <div key={g.key + ":empty"} style={{ padding: "2px 12px 6px 34px", fontSize: 11.5, color: "var(--dimmer)" }}>Empty. Right-click a repo to move it here.</div>,
                    ...(collapsed.includes(g.key) ? [] : g.items).map((x) => {
                    const bi = bInfo(x);
                    return (
                      <div key={x.id} className="hov" title="Add to workfolder" onClick={() => park(x.id, false)} onContextMenu={(e) => openCtx(e, reserveCtx(x))} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 8px 7px 30px" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, height: 18 }}>
                            <span className="ellip" style={{ color: "var(--mid)" }}>{x.id}</span><span className="spacer" />
                            {othersBadge(x)}
                            <span style={{ fontSize: 11, color: "var(--dimmer)", whiteSpace: "nowrap" }}>{used[x.id] ? "used " + ago(used[x.id]) : x.commits[0]?.when}</span>
                          </div>
                          <div className="mono" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 11, minWidth: 0 }}>
                            <span className="chip" style={{ background: "color-mix(in srgb, var(--fg) 4%, transparent)", color: "var(--dim)" }}><I n={bi.chipIcon} style={{ fontSize: 11, flex: "none" }} /><span className="ellip">{bi.branchText}</span></span>
                            <span style={{ color: bi.syncColor, whiteSpace: "nowrap", flex: "none" }}>{bi.sync}</span>
                            {x.changes.length > 0 && <span style={{ color: "var(--mod)", whiteSpace: "nowrap", fontFamily: "Inter,sans-serif" }}>{x.changes.length} uncommitted</span>}
                          </div>
                        </div>
                        <button className="ib" title="Add to workfolder" style={{ width: 22, height: 22, borderRadius: 5, fontSize: 13, color: "var(--dim)" }}><I n="ph-arrow-line-up" /></button>
                      </div>
                    );
                  })])}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Source control */}
        {panel === "git" && (
          <div className="panel" style={{ width: sizes.side }}>
            {sideHandle}
            <div className="head" style={{ gap: 6, padding: "0 10px 0 12px" }}>
              <button className="ghost" onClick={() => setOv(ov === "repoMenu" ? null : "repoMenu")} style={{ height: 26, padding: "0 8px", borderRadius: 6, color: "var(--fg)", fontWeight: 500 }}>{r.id || "—"}<I n="ph-caret-down" style={{ fontSize: 11, color: "var(--dim)" }} /></button>
              <div className="spacer" />
              <button className="ib" title="Pull" onClick={pull} style={{ width: "auto", padding: "0 6px", gap: 3, fontSize: 11 }}><I n="ph-arrow-down" style={{ fontSize: 12 }} />{cur.behind || 0}</button>
              <button className="ib" title="Push" onClick={push} style={{ width: "auto", padding: "0 6px", gap: 3, fontSize: 11 }}><I n="ph-arrow-up" style={{ fontSize: 12 }} />{cur.ahead || 0}</button>
            </div>
            {ov === "repoMenu" && (
              <div className="pop" style={{ position: "absolute", top: 38, left: 12, width: 220, zIndex: 5, borderRadius: 8, padding: 4 }}>
                {live.map((x) => (
                  <div key={x.id} className="hov" onClick={() => { setActive(x.id); setOv(null); }} style={{ display: "flex", alignItems: "center", gap: 8, height: 28, padding: "0 8px", borderRadius: 5, color: x.id === r.id ? "var(--fg)" : "var(--soft)" }}>
                    <span style={{ flex: 1 }}>{x.id}</span><span className="mono ellip" style={{ fontSize: 11, color: "var(--dimmer)", maxWidth: 110 }}>{x.branch}</span>
                  </div>
                ))}
              </div>
            )}
            {!r.git && (
              <div style={{ padding: "4px 16px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--mid)" }}><I n="ph-folder-simple-dashed" style={{ fontSize: 16 }} /><span className="mono ellip" style={{ fontSize: 11.5 }}>{r.src || `${root}/${r.id}`}</span></div>
                <div style={{ marginTop: 10, color: "var(--soft)", lineHeight: 1.55 }}>This is a plain folder. Initialize git to track changes, branch, and run reviews.</div>
                <button className="btn" onClick={() => initGit(r.id)} style={{ width: "100%", marginTop: 12 }}><I n="ph-git-commit" />Initialize repository</button>
              </div>
            )}
            {r.git && <>
            <div style={{ padding: "0 12px 12px" }}>
              <button className="ghost mono" onClick={() => showOv("branch")} style={{ width: "100%", height: 30, padding: "0 10px", border: "1px solid var(--border)", color: "var(--code)", fontSize: 12, gap: 8 }}>
                <I n="ph-git-branch" style={{ fontSize: 14, color: "var(--acc)" }} /><span className="ellip" style={{ flex: 1, textAlign: "left" }}>{r.branch}</span><I n="ph-caret-up-down" style={{ fontSize: 12, color: "var(--dim)" }} />
              </button>
              <textarea value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); commit(); } }}
                placeholder={`Commit message  (${K}Enter)`} rows={3}
                style={{ display: "block", width: "100%", marginTop: 8, resize: "none", background: "color-mix(in srgb, var(--fg) 2.5%, transparent)", border: "1px solid var(--border2)", borderRadius: 8, padding: "8px 10px", color: "var(--fg)", fontSize: 13, lineHeight: "18px", outline: "none" }}
                onFocus={(e) => (e.target.style.borderColor = "var(--acc-strong)")} onBlur={(e) => (e.target.style.borderColor = "var(--border2)")} />
              <button className="btn" onClick={commit} disabled={!commitMsg.trim() || !r.changes.length} style={{ width: "100%", marginTop: 8, fontWeight: 500 }}>{commitLabel}</button>
              {r.id && !r.remote && <button className="ghost" onClick={() => publish(r.id)} style={{ width: "100%", marginTop: 4, height: 28, justifyContent: "center", fontSize: 12 }}><I n="ph-cloud-arrow-up" />Publish to GitHub</button>}
              {r.changes.length > 0 && <button className="ghost" onClick={() => runReview("changes")} style={{ width: "100%", marginTop: 4, height: 28, justifyContent: "center", fontSize: 12, color: "var(--acc-soft)" }}><I n="ph-sparkle" />Review {r.changes.length} change{r.changes.length === 1 ? "" : "s"} with AI</button>}
              {dirtyRepos.length > 1 && <button className="ghost" onClick={openMulti} style={{ width: "100%", marginTop: 4, height: 28, justifyContent: "center", fontSize: 12 }}><I n="ph-stack" />Commit across {dirtyRepos.length} repos…</button>}
            </div>
            <div className="scroll">
              {!r.changes.length && <div style={{ padding: "8px 16px 16px", color: "var(--dim)", lineHeight: 1.5 }}>Working tree clean on <span className="mono" style={{ color: "var(--soft)" }}>{r.branch}</span>.</div>}
              {[["Staged", "Unstage all", staged, false], ["Changes", "Stage all", unstaged, true]].filter((g) => g[2].length).map(([label, action, items, to]) => (
                <div key={label} style={{ marginBottom: 8 }}>
                  <div className="label" style={{ display: "flex", alignItems: "center", height: 26, padding: "0 12px 0 16px" }}>
                    <span style={{ flex: 1 }}>{label}</span><span className="linkish" onClick={() => stageAll(to)} style={{ textTransform: "none", letterSpacing: 0 }}>{action}</span>
                  </div>
                  {items.map((c) => {
                    const parts = c.path.split("/"), name = parts.pop(), isOpen = open && open.repo === r.id && open.path === c.path;
                    return (
                      <div key={c.path} className="hov" onClick={() => openFile(r.id, c.path, "diff")} onContextMenu={(e) => openCtx(e, fileCtx(r, c.path))} style={{ display: "flex", alignItems: "center", gap: 8, height: 28, padding: "0 12px 0 16px", background: isOpen ? "color-mix(in srgb, var(--acc) 12%, transparent)" : undefined }}>
                        <Check on={c.staged} title={c.staged ? "Unstage" : "Stage"} onClick={(e) => { e.stopPropagation(); stage(c); }} />
                        <span style={{ whiteSpace: "nowrap" }}>{name}</span>
                        <span className="ellip" style={{ flex: 1, minWidth: 0, color: "var(--dimmer)", fontSize: 11.5 }}>{parts.join("/")}</span>
                        <span className="mono" style={{ fontSize: 11, color: ST[c.status] || "var(--mod)" }}>{c.status}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
              <div className="label" style={{ height: 26, display: "flex", alignItems: "center", padding: "0 16px", marginTop: 8 }}>History</div>
              {r.commits.map((h) => (
                <div key={h.sha} style={{ display: "flex", gap: 10, padding: "5px 16px", alignItems: "baseline" }}>
                  <span className="mono" style={{ fontSize: 11, color: "var(--dimmer)", flex: "none" }}>{h.sha}</span>
                  <span className="ellip" style={{ flex: 1, minWidth: 0, color: "var(--soft)" }}>{h.msg}</span>
                  <span style={{ fontSize: 11, color: "var(--dimmer)", flex: "none" }}>{h.when.replace(/ ago$/, "")}</span>
                </div>
              ))}
              {(r.stashes.length > 0 || r.changes.length > 0) && <div className="label" style={{ height: 26, display: "flex", alignItems: "center", padding: "0 12px 0 16px", marginTop: 8 }}>
                <span style={{ flex: 1 }}>Stashes</span>
                {r.changes.length > 0 && <span className="linkish" onClick={() => act(r.id, () => git(r.id, "stash", "push", "-u"), `Stashed ${r.changes.length} change${r.changes.length > 1 ? "s" : ""}`)} style={{ textTransform: "none", letterSpacing: 0 }}>Stash changes</span>}
              </div>}
              {r.stashes.map((st) => (
                <div key={st.sha} className="hov" onContextMenu={(e) => openCtx(e, stashCtx(st))} style={{ display: "flex", gap: 6, padding: "3px 10px 3px 16px", alignItems: "center" }}>
                  <span className="ellip" title={st.sha + "\n" + st.msg} style={{ flex: 1, minWidth: 0, color: "var(--soft)" }}>{st.msg.replace(/^(On|WIP on) [^:]+: /, "")}</span>
                  <span style={{ fontSize: 11, color: "var(--dimmer)", flex: "none" }}>{st.when.replace(/ ago$/, "")}</span>
                  <button className="ib" title="Apply" onClick={stashCtx(st)[0].run} style={{ width: 22, height: 22, fontSize: 13 }}><I n="ph-tray-arrow-up" /></button>
                  <button className="ib" title="Drop" onClick={() => dropStash(st)} style={{ width: 22, height: 22, fontSize: 13 }}><I n="ph-trash" /></button>
                </div>
              ))}
            </div>
            </>}
          </div>
        )}

        {/* Issues */}
        {panel === "issues" && (
          <div className="panel" style={{ width: sizes.side }}>
            {sideHandle}
            <div className="head" style={{ gap: 8, padding: "0 12px 0 16px" }}>
              <span className="label">Issues</span>{prRepos.length < 2 && <span style={{ fontSize: 11.5, color: "var(--dimmer)" }}>{r.id}</span>}
              <div className="spacer" />
              {r.id && <button className="ib" title={issueCompact ? "Detailed list" : "Compact list"} onClick={() => setIssueCompact((c) => { store.set("nb.issueCompact", !c); return !c; })}><I n={issueCompact ? "ph-rows" : "ph-list"} /></button>}
              {r.remote && <button className="ib" title={`New issue in ${r.id} (opens GitHub)`} onClick={() => gh(r.id, "issue", "create", "--web").catch((e) => say(e, true))}><I n="ph-plus" /></button>}
              {r.id && <button className="ib" title="Refresh" onClick={() => prRepos.forEach((x) => x.remote && loadIssues(x.id))}><I n="ph-arrows-clockwise" /></button>}
            </div>
            {r.id && <div style={{ padding: "0 12px 10px" }}>{seg([["open", "Open"], ["closed", "Closed"], ["all", "All"]].map(([k, label]) => [label, issueFilter === k, () => setIssueFilter(k)]))}
            <div style={{ display: "flex", alignItems: "center", gap: 8, height: 28, padding: "0 10px", marginTop: 8, borderRadius: 7, background: "color-mix(in srgb, var(--bg) 70%, transparent)", boxShadow: "0 0 0 1px var(--border)" }}>
              <I n="ph-magnifying-glass" style={{ color: "var(--dim)", fontSize: 12 }} />
              <input className="field" value={issueQ} onChange={(e) => setIssueQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setIssueQ(""))} placeholder="Filter: title, #, label, author" style={{ flex: 1, fontSize: 12.5 }} />
            </div></div>}
            {!r.id && <div style={{ padding: "8px 16px", color: "var(--dim)", lineHeight: 1.55 }}>No repos to fetch issues from. <span className="linkish" onClick={openAdd}>Add a folder</span> to your workspace to see its issues here.</div>}
            <div className="scroll">
              {prRepos.filter((x) => x.remote).map((rp, _, all) => {
                const many = all.length > 1, list = issues[rp.id]?.filter((i) => (issueFilter === "all" || i.state === issueFilter) && fuzzy(issueQ, `#${i.num} ${i.title} ${i.author} ${i.labels.map((l) => l.name).join(" ")} ${i.assignees.join(" ")}`));
                return (
                  <div key={rp.id}>
                    {many && <div style={{ display: "flex", gap: 6, padding: "10px 16px 4px", fontSize: 11.5, color: "var(--dimmer)" }}><span className="ellip">{rp.id}</span>{list && <span>{list.length}</span>}</div>}
                    {list && !list.length && <div style={{ padding: many ? "2px 16px 6px" : "8px 16px", color: "var(--dim)" }}>{issueQ.trim() ? "No matches." : issueFilter === "all" ? "No issues yet." : `No ${issueFilter} issues.`}</div>}
                    {!list && <div style={{ padding: "8px 16px", color: "var(--dim)", display: "flex", gap: 8, alignItems: "center" }}><I n="ph-circle-notch spin" />Loading…</div>}
                    {(list || []).map((i) => (
                      <div key={i.num} className="hov" title={issueCompact ? `#${i.num} ${i.title}` : undefined} onContextMenu={(e) => openCtx(e, issueCtx(i, rp.id))} onClick={() => showIssue(i.num, rp.id)} style={{ display: "flex", gap: issueCompact ? 8 : 10, alignItems: issueCompact ? "center" : undefined, padding: issueCompact ? "3px 14px 3px 16px" : "8px 14px 8px 16px", background: openIssue?.repo === rp.id && openIssue.num === i.num ? "color-mix(in srgb, var(--acc) 12%, transparent)" : undefined }}>
                        <I n={i.state === "open" ? "ph-circle-dashed" : "ph-check-circle"} style={{ fontSize: issueCompact ? 13 : 15, color: i.state === "open" ? "var(--add)" : "var(--acc-soft)", marginTop: issueCompact ? 0 : 1 }} />
                        {issueCompact ? <span className="mono" style={{ fontSize: 11.5, color: "var(--dim)", flex: 1 }}>#{i.num}</span> : <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ lineHeight: 1.35 }}>{i.title}</div>
                          <div className="ellip" style={{ fontSize: 11, color: "var(--dim)", marginTop: 3 }}><span className="mono">#{i.num}</span> · {i.author}{i.labels.length > 0 && " · " + i.labels.map((l) => l.name).join(", ")}</div>
                        </div>}
                        {i.comments.length > 0 && <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--dimmer)", flex: "none", height: issueCompact ? undefined : 18 }}><I n="ph-chat-circle" />{i.comments.length}</span>}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Pull requests */}
        {panel === "prs" && (
          <div className="panel" style={{ width: sizes.side }}>
            {sideHandle}
            <div className="head" style={{ gap: 8, padding: "0 12px 0 16px" }}>
              <span className="label">Pull requests</span>{prRepos.length < 2 && <span style={{ fontSize: 11.5, color: "var(--dimmer)" }}>{r.id}</span>}
              <div className="spacer" />
              {r.id && <button className="ib" title={prCompact ? "Detailed list" : "Compact list"} onClick={() => setPrCompact((c) => { store.set("nb.prCompact", !c); return !c; })}><I n={prCompact ? "ph-rows" : "ph-list"} /></button>}
              {r.id && <button className="ib" title="Refresh" onClick={() => prRepos.forEach((x) => loadPRs(x.id))}><I n="ph-arrows-clockwise" /></button>}
            </div>
            {r.id && <div style={{ padding: "0 12px 10px" }}>{seg([["open", "Open"], ["merged", "Merged"], ["closed", "Closed"], ["all", "All"]].map(([k, label]) => [label, prFilter === k, () => setPrFilter(k)]))}
            <div style={{ display: "flex", alignItems: "center", gap: 8, height: 28, padding: "0 10px", marginTop: 8, borderRadius: 7, background: "color-mix(in srgb, var(--bg) 70%, transparent)", boxShadow: "0 0 0 1px var(--border)" }}>
              <I n="ph-magnifying-glass" style={{ color: "var(--dim)", fontSize: 12 }} />
              <input className="field" value={prQ} onChange={(e) => setPrQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setPrQ(""))} placeholder="Filter: title, #, branch, author" style={{ flex: 1, fontSize: 12.5 }} />
            </div></div>}
            {canOpenPR && <div style={{ padding: "0 12px 10px" }}><button className="btn" onClick={createPR} style={{ width: "100%" }}><I n="ph-git-pull-request" /><span className="ellip">Open PR from {r.branch}</span></button></div>}
            {!r.id && <div style={{ padding: "8px 16px", color: "var(--dim)", lineHeight: 1.55 }}>No repos to fetch pull requests from. <span className="linkish" onClick={openAdd}>Add a folder</span> to your workspace to see its PRs here.</div>}
            <div className="scroll">
              {prRepos.map((rp) => {
                const many = prRepos.length > 1;
                // "open" includes drafts
                const list = prs[rp.id]?.filter((p) => (prFilter === "all" || p.state === prFilter || (prFilter === "open" && p.state === "draft")) && fuzzy(prQ, `#${p.num} ${p.title} ${p.head} ${p.author}`));
                return (
                  <div key={rp.id}>
                    {many && <div style={{ display: "flex", gap: 6, padding: "10px 16px 4px", fontSize: 11.5, color: "var(--dimmer)" }}><span className="ellip">{rp.id}</span>{list && <span>{list.length}</span>}</div>}
                    {list && !list.length && <div style={{ padding: many ? "2px 16px 6px" : "8px 16px", color: "var(--dim)" }}>{prQ.trim() ? "No matches." : prFilter === "all" ? "No pull requests yet." : `No ${prFilter} pull requests.`}</div>}
                    {!list && <div style={{ padding: "8px 16px", color: "var(--dim)", display: "flex", gap: 8, alignItems: "center" }}><I n="ph-circle-notch spin" />Loading…</div>}
                    {(list || []).map((p) => {
                      const worst = !p.checks.length ? null : p.checks.some((c) => c.k === "fail") ? "fail" : p.checks.some((c) => c.k === "pending") ? "pending" : "pass";
                      return (
                        <div key={p.num} className="hov" title={prCompact ? `#${p.num} ${p.title}\n${p.head}` : undefined} onContextMenu={(e) => openCtx(e, prCtx(p, rp))} onClick={() => showPR(p.num, rp.id)} style={{ display: "flex", gap: prCompact ? 8 : 10, alignItems: prCompact ? "center" : undefined, padding: prCompact ? "3px 14px 3px 16px" : "8px 14px 8px 16px", background: openPR === p.num && r.id === rp.id ? "color-mix(in srgb, var(--acc) 12%, transparent)" : undefined }}>
                          <I n={p.state === "merged" ? "ph-git-merge" : "ph-git-pull-request"} style={{ fontSize: prCompact ? 13 : 15, color: PRC[p.state], marginTop: prCompact ? 0 : 1 }} />
                          {prCompact ? <><span className="mono" style={{ fontSize: 11.5, color: "var(--dim)", flex: 1 }}>#{p.num}</span></> : <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ lineHeight: 1.35 }}>{p.title}</div>
                            <div className="mono ellip" style={{ fontSize: 11, color: "var(--dim)", marginTop: 3 }}>#{p.num} · {p.head}</div>
                          </div>}
                          {worst && <I n={CHK[worst][0]} style={{ fontSize: 13, color: CHK[worst][1], marginTop: prCompact ? 0 : 2 }} />}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Editor (also the area popped-out terminals snap within) */}
        <div id="term-area" style={{ flex: 1, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {showReport && (
            <Report rv={review} stats={revStats} pr={revPR} go={goFinding} close={() => setReportOpen(false)}
              copy={() => copy(reportMarkdown(review))}
              download={() => invoke("save_md", { name: `review-${review.repo}.md`, text: reportMarkdown(review) }).then((p) => say("Saved " + p), (e) => say(e, true))}
              post={() => act(review.repo, () => gh(review.repo, "pr", "comment", String(revPR.num), "--body", reportMarkdown(review)), `Posted review to #${revPR.num} on GitHub`)} />
          )}

          {hasRepos && open && !pr && !showReport && (
            <>
              <div className="head" style={{ gap: 12, padding: "0 12px 0 20px", borderBottom: "1px solid color-mix(in srgb, var(--fg) 5%, transparent)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}>
                  {[open.repo, ...open.path.split("/")].map((t, i, a) => (
                    <span key={i} style={{ display: "contents" }}><span className="ellip" style={{ color: i === a.length - 1 ? "var(--fg)" : "var(--dim)", flex: i === a.length - 1 ? "none" : "0 1 auto", minWidth: 0 }}>{t}</span>{i < a.length - 1 && <span style={{ color: "var(--border)" }}>/</span>}</span>
                  ))}
                  {fileChanged && <span className="mono" style={{ marginLeft: 8, flex: "none", fontSize: 11 }}><span style={{ color: ST.A }}>+{adds}</span> <span style={{ color: ST.D }}>−{dels}</span></span>}
                </div>
                <button className="ghost" title="Review this file with AI" onClick={() => runReview("file", { paths: [open.path] }, openRepo)} style={{ height: 26, flex: "none", padding: "0 8px", borderRadius: 7, fontSize: 12, color: "var(--acc-soft)" }}><I n="ph-sparkle" />Review</button>
                {fileChanged && v === "diff" && seg([["Unified", diffStyle === "unified", () => setDiffStyle("unified")], ["Split", diffStyle === "split", () => setDiffStyle("split")]])}
                {fileChanged && seg([["Code", v === "code", () => setView("code")], ["Diff", v === "diff", () => setView("diff")]])}
                <button className="ib" title="Close" onClick={() => setOpen(null)} style={{ color: "var(--dim)" }}><I n="ph-x" /></button>
              </div>
              <div onContextMenu={(e) => openCtx(e, editorCtx())} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{body}</div>
            </>
          )}

          {hasRepos && !open && !pr && !iss && !showReport && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 12%" }}>
              <div className="keys">{keyRows}</div>
            </div>
          )}

          {hasRepos && pr && !showReport && (
            <>
              <div className="head" style={{ gap: 8, padding: "0 12px 0 20px", borderBottom: "1px solid color-mix(in srgb, var(--fg) 5%, transparent)" }}>
                <span style={{ color: "var(--dim)" }}>{r.id}</span><span style={{ color: "var(--border)" }}>/</span><span>Pull request #{pr.num}</span>
                <div className="spacer" />
                <button className="ib" title="Close" onClick={() => setOpenPR(null)} style={{ color: "var(--dim)" }}><I n="ph-x" /></button>
              </div>
              <div style={{ flex: 1, overflow: "auto", minHeight: 0, padding: "32px 40px 48px" }}>
                <div style={{ maxWidth: 720 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--dim)", flexWrap: "wrap" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 5, color: PRC[pr.state] }}><I n="ph-git-pull-request" />{pr.state[0].toUpperCase() + pr.state.slice(1)}</span>
                    <span>#{pr.num}</span><span>·</span><span>{pr.author}</span><span>·</span><span>{pr.when}</span><span>·</span><span>{pr.review}</span>
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 500, marginTop: 10, lineHeight: 1.25 }}>{pr.title}</div>
                  <div className="mono" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 12 }}>
                    <span style={{ padding: "3px 8px", borderRadius: 5, background: "var(--chip)", color: "var(--acc-fg)" }}>{pr.head}</span>
                    <I n="ph-arrow-right" style={{ color: "var(--dimmer)" }} />
                    <span style={{ padding: "3px 8px", borderRadius: 5, background: "var(--border2)", color: "var(--soft)" }}>{pr.base}</span>
                  </div>
                  {pr.body && <div style={{ marginTop: 22, color: "var(--soft)", lineHeight: 1.65, maxWidth: "62ch", whiteSpace: "pre-wrap" }}>{pr.body}</div>}
                  {pr.checks.length > 0 && <>
                    <div className="label" style={{ marginTop: 28 }}>Checks</div>
                    <div style={{ marginTop: 8, display: "flex", flexDirection: "column" }}>
                      {pr.checks.map((c, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, height: 30 }}>
                          <I n={CHK[c.k][0]} style={{ fontSize: 15, color: CHK[c.k][1] }} />
                          <span className="mono ellip" style={{ fontSize: 12.5, width: 180 }}>{c.label}</span>
                          <span style={{ color: "var(--dim)", fontSize: 12 }}>{c.detail}</span>
                        </div>
                      ))}
                    </div>
                  </>}
                  <div style={{ marginTop: 24, display: "flex", alignItems: "baseline", gap: 8 }}><span className="label">Files changed</span><span style={{ fontSize: 11, color: "var(--dimmer)" }}>{pr.files.length} file{pr.files.length === 1 ? "" : "s"}</span></div>
                  <div style={{ marginTop: 6, display: "flex", flexDirection: "column", marginLeft: -10 }}>
                    {pr.files.map((f) => {
                      const parts = f.path.split("/"), name = parts.pop();
                      return (
                        <div key={f.path} className="hov" onClick={() => openFile(r.id, f.path, r.changes.some((c) => c.path === f.path) ? "diff" : "code")} style={{ display: "flex", alignItems: "center", gap: 10, height: 30, padding: "0 10px", borderRadius: 6 }}>
                          <I n="ph-file" style={{ color: "var(--dimmer)" }} /><span>{name}</span>
                          <span className="ellip" style={{ flex: 1, minWidth: 0, color: "var(--dimmer)", fontSize: 12 }}>{parts.join("/")}</span>
                          <span className="mono" style={{ fontSize: 11, color: ST.A }}>+{f.adds}</span><span className="mono" style={{ fontSize: 11, color: ST.D }}>−{f.dels}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 28, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {pr.state === "open" && <button className="btn" style={{ height: 32, padding: "0 16px", fontSize: 13, fontWeight: 500 }} onClick={() => prAct(() => gh(r.id, "pr", "merge", String(pr.num), "--squash"), `Merged #${pr.num} into ${pr.base}`)}><I n="ph-git-merge" />Squash and merge</button>}
                    {pr.state === "merged" && <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--acc-soft)", fontSize: 13, paddingRight: 8 }}><I n="ph-git-merge" />Merged into {pr.base}</span>}
                    <button className="ghost" onClick={() => act(r.id, () => stashAnd(r.id, pr.head, () => gh(r.id, "pr", "checkout", String(pr.num))), "Switched to " + pr.head)}>Check out branch</button>
                    <button className="ghost" onClick={() => gh(r.id, "pr", "view", String(pr.num), "--web").catch((e) => say(e, true))}><I n="ph-arrow-square-out" />GitHub</button>
                  </div>
                </div>
              </div>
            </>
          )}

          {hasRepos && iss && !showReport && (
            <>
              <div className="head" style={{ gap: 8, padding: "0 12px 0 20px", borderBottom: "1px solid color-mix(in srgb, var(--fg) 5%, transparent)" }}>
                <span style={{ color: "var(--dim)" }}>{openIssue.repo}</span><span style={{ color: "var(--border)" }}>/</span><span>Issue #{iss.num}</span>
                <div className="spacer" />
                <button className="ib" title="Close" onClick={() => setOpenIssue(null)} style={{ color: "var(--dim)" }}><I n="ph-x" /></button>
              </div>
              <div style={{ flex: 1, overflow: "auto", minHeight: 0, padding: "32px 40px 48px" }}>
                <div style={{ maxWidth: 720 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--dim)", flexWrap: "wrap" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 5, color: iss.state === "open" ? "var(--add)" : "var(--acc-soft)" }}><I n={iss.state === "open" ? "ph-circle-dashed" : "ph-check-circle"} />{iss.state === "open" ? "Open" : "Closed"}</span>
                    <span>#{iss.num}</span><span>·</span><span>{iss.author}</span><span>·</span><span>{iss.when}</span>
                    {iss.assignees.length > 0 && <><span>·</span><span>assigned to {iss.assignees.join(", ")}</span></>}
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 500, marginTop: 10, lineHeight: 1.25 }}>{iss.title}</div>
                  {iss.labels.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
                    {iss.labels.map((l) => <span key={l.name} style={{ padding: "2px 8px", borderRadius: 10, fontSize: 11.5, background: `color-mix(in srgb, ${l.color} 22%, transparent)`, color: `color-mix(in srgb, ${l.color} 55%, var(--fg))` }}>{l.name}</span>)}
                  </div>}
                  {iss.body && <div style={{ marginTop: 22, color: "var(--soft)", lineHeight: 1.65, maxWidth: "62ch", whiteSpace: "pre-wrap" }}>{iss.body}</div>}
                  {iss.comments.length > 0 && <>
                    <div className="label" style={{ marginTop: 28 }}>Comments</div>
                    {iss.comments.map((c, n) => (
                      <div key={n} style={{ marginTop: 12, paddingLeft: 12, boxShadow: "inset 2px 0 0 var(--border)" }}>
                        <div style={{ fontSize: 12, color: "var(--dim)" }}>{c.author} · {c.when}</div>
                        <div style={{ marginTop: 4, color: "var(--soft)", lineHeight: 1.6, maxWidth: "62ch", whiteSpace: "pre-wrap" }}>{c.body}</div>
                      </div>
                    ))}
                  </>}
                  <div style={{ marginTop: 28, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <button className="btn" style={{ height: 32, padding: "0 16px", fontSize: 13, fontWeight: 500 }} onClick={issueCtx(iss, openIssue.repo)[1].run}><I n="ph-git-branch" />Start a branch</button>
                    <button className="ghost" onClick={issueCtx(iss, openIssue.repo)[5].run}>{iss.state === "open" ? "Close issue" : "Reopen issue"}</button>
                    <button className="ghost" onClick={() => gh(openIssue.repo, "issue", "view", String(iss.num), "--web").catch((e) => say(e, true))}><I n="ph-arrow-square-out" />GitHub</button>
                  </div>
                </div>
              </div>
            </>
          )}

          {!hasRepos && repos.length > 0 && (
            <div style={{ flex: 1, overflow: "auto", display: "flex", padding: "40px 12%" }}>
              <div style={{ maxWidth: 440, width: "100%", margin: "auto 0" }}>
                <div style={{ fontSize: 22, fontWeight: 500 }}><span className="mono" style={{ fontSize: 19, color: "var(--soft)" }}>{root}</span> is empty</div>
                <div style={{ marginTop: 8, color: "var(--mid)", lineHeight: 1.55 }}>Everything is in reserve. Bring back what you need for this session.</div>
                <div style={{ marginTop: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {lastSet.length > 0 && <button className="btn" onClick={restoreSet} style={{ height: 32, padding: "0 14px", fontSize: 13 }}><I n="ph-arrow-counter-clockwise" />Restore last set ({lastSet.length})</button>}
                  <button className="ghost" onClick={openAdd}><I n="ph-plus" />Add repo or folder</button>
                </div>
                <div style={{ marginTop: 24, display: "flex", flexDirection: "column", marginLeft: -10 }}>
                  {rgroups.map((g) => [
                    groupHead(g, { padding: "12px 10px 6px", fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--dim)", borderRadius: 6 }),
                    ...(collapsed.includes(g.key) ? [] : g.items).map((x) => { const bi = bInfo(x); return (
                    <div key={x.id} className="hov" onClick={() => park(x.id, false)} onContextMenu={(e) => openCtx(e, reserveCtx(x))} style={{ display: "flex", alignItems: "center", gap: 10, height: 36, padding: "0 10px", borderRadius: 8 }}>
                      <span style={{ flex: "none" }}>{x.id}</span>
                      <span className="mono" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--dim)", minWidth: 0, overflow: "hidden" }}><I n={bi.chipIcon} style={{ flex: "none" }} /><span className="ellip">{bi.branchText}</span></span>
                      <span className="spacer" />{used[x.id] && <span style={{ fontSize: 11.5, color: "var(--dimmer)" }}>{ago(used[x.id])}</span>}<I n="ph-arrow-line-up" style={{ color: "var(--acc)" }} />
                    </div>
                  ); })])}
                </div>
              </div>
            </div>
          )}

          {repos.length === 0 && (
            <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "center", padding: "40px 12%" }}>
              <div style={{ maxWidth: 460, width: "100%" }}>
                <div style={{ fontSize: 24, fontWeight: 500 }}>Set up your workfolder</div>
                <div style={{ marginTop: 8, color: "var(--mid)", lineHeight: 1.55 }}>One folder, many repositories. Branches, diffs and pull requests follow whichever one you're in.</div>
                <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 4 }}>
                  {obSteps.map((st) => (
                    <div key={st.n} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0" }}>
                      {st.done
                        ? <span style={{ width: 24, height: 24, flex: "none", borderRadius: "50%", background: "var(--chip)", color: "var(--acc-fg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}><I n="ph-check" /></span>
                        : <span style={{ width: 24, height: 24, flex: "none", borderRadius: "50%", boxShadow: "0 0 0 1px var(--dimmer)", color: "var(--mid)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5 }}>{st.n}</span>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500 }}>{st.title}</div>
                        <div style={{ color: "var(--dim)", fontSize: 12.5, marginTop: 2 }}>{st.desc}</div>
                      </div>
                      {!st.done && <button className="btn" style={{ height: 28, borderRadius: 7 }} onClick={st.onClick}>{st.btn}</button>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Terminals: docked ones side by side in the bottom panel, popped-out ones float over the app with their own colour.
              All stay in this one list, so docking or popping out never restarts a shell. */}
          {(() => {
            const docked = terms.filter((t) => !t.float && mine(t)), shown = termOpen && docked.length > 0;
            const floats = terms.filter((t) => t.float).sort((a, b) => a.float.z - b.float.z).map((t) => t.id);
            const dark = document.documentElement.style.colorScheme !== "light";
            return (
              <div style={{ flex: "none", position: "relative", display: "flex", height: shown ? sizes.term : 0, borderTop: shown ? "1px solid color-mix(in srgb, var(--fg) 7%, transparent)" : "none" }}>
                {shown && <Resizer axis="y" grow={-1} value={sizes.term} min={110} max={() => window.innerHeight * 0.75} set={sizer("term")} reset={resetSize("term")} style={{ top: -4 }} />}
                {terms.map((t) => {
                  const f = t.float, c = f && pastel(f.hue, dark), last = !f && t.id === docked.at(-1)?.id;
                  const btn = { width: 22, height: 22, borderRadius: 5, color: c ? c.ink : "var(--dim)" };
                  return (
                    <div key={t.id} data-snapped={f?.snapped ? t.id : undefined} style={f
                      // the native corner handle (resize: both) sizes it; xterm refits through its ResizeObserver
                      ? { position: "fixed", left: Math.min(f.x, window.innerWidth - 80), top: Math.min(f.y, window.innerHeight - 40), width: f.w, height: f.h, minWidth: 320, minHeight: 140, maxWidth: "100vw", maxHeight: "100vh", resize: "both", overflow: "hidden", zIndex: 10 + floats.indexOf(t.id), display: floatsHidden ? "none" : "flex", flexDirection: "column", background: c.bg, border: `1px solid ${c.bar}`, borderRadius: 10, boxShadow: "0 18px 50px rgba(0,0,0,.45)" }
                      : { display: termOpen && mine(t) ? "flex" : "none", flexDirection: "column", flex: "1 1 0", minWidth: 0, borderLeft: t.id === docked[0]?.id ? "none" : "1px solid color-mix(in srgb, var(--fg) 7%, transparent)" }}>
                      <div onPointerDown={(e) => dragPane(e, t)} title={f ? "Drag to move; drop on the bottom edge to dock" : "Drag up to pop out"}
                        onContextMenu={(e) => openCtx(e, [
                          { icon: "ph-plus", label: "New terminal", hint: "⌃`", run: newTerm },
                          f ? { icon: "ph-arrow-square-down", label: "Dock at the bottom", run: () => dock(t) } : { icon: "ph-arrow-square-out", label: "Pop out", run: () => popOut(t) },
                          { icon: "ph-broom", label: "Clear", run: () => window.dispatchEvent(new CustomEvent("nb-term-clear", { detail: t.id })) },
                          { sep: true },
                          ...GRIDS.map((g) => ({ icon: settings.termGrid === g ? "ph-check" : "ph-grid-four", label: "Snap: " + gridName(g), run: () => { saveSettings({ termGrid: g }); setTick((n) => n + 1); } })),
                          { sep: true },
                          { icon: "ph-x", label: "Close terminal", danger: true, run: () => closeTerm(t.id) },
                        ])}
                        style={{ height: 30, flex: "none", display: "flex", alignItems: "center", gap: 2, padding: "0 6px 0 12px", fontSize: 12, userSelect: "none", cursor: f ? "move" : "default", background: c ? c.bar : "transparent", color: c ? c.ink : "var(--dim)" }}>
                        <I n="ph-terminal" style={{ fontSize: 12, marginRight: 4 }} /><span className="ellip" style={{ fontWeight: f ? 500 : 400 }}>{t.repo || "work"}</span>
                        <div className="spacer" />
                        {last && <button className="ib" title="New terminal" onClick={() => newTerm()} style={btn}><I n="ph-plus" /></button>}
                        <button className="ib" title={f ? "Dock at the bottom" : "Pop out"} onClick={() => (f ? dock(t) : popOut(t))} style={btn}><I n={f ? "ph-arrow-square-down" : "ph-arrow-square-out"} /></button>
                        {last && <button className="ib" title="Hide terminals" onClick={toggleTerm} style={btn}><I n="ph-caret-down" /></button>}
                        <button className="ib" title="Close terminal" onClick={() => closeTerm(t.id)} style={btn}><I n="ph-x" /></button>
                      </div>
                      <Term tab={t.id} repo={t.repo} cmd={t.cmd} bg={c?.bg} visible={f ? !floatsHidden : termOpen && mine(t)} onExit={() => closeTerm(t.id)} onEnter={() => termEnter(t.repo)} />
                    </div>
                  );
                })}
                {/* while dragging: the grid's cells faintly, the target cell (or the dock) highlighted */}
                {snap && /^\d+x\d+$/.test(settings.termGrid) && (() => {
                  const [cols, rows] = settings.termGrid.split("x").map(Number);
                  return Array.from({ length: cols * rows }, (_, i) => {
                    const a = termArea(), c = inArea(cellRect(i % cols, Math.floor(i / cols), cols, rows, a.w, a.h), a);
                    return <div key={"cell" + i} style={{ position: "fixed", pointerEvents: "none", zIndex: 18, left: c.x, top: c.y, width: c.w, height: c.h, borderRadius: 10, border: "1px dashed color-mix(in srgb, var(--acc) 45%, transparent)" }} />;
                  });
                })()}
                {snap && <div style={{ position: "fixed", pointerEvents: "none", zIndex: 19, borderRadius: 10, border: `2px solid ${snap.blocked ? "var(--del)" : "var(--acc)"}`, background: `color-mix(in srgb, ${snap.blocked ? "var(--del)" : "var(--acc)"} 12%, transparent)`, transition: "all .12s ease-out",
                  ...(snap === "dock" ? { left: 4, right: 4, bottom: 30, height: Math.min(sizes.term, 240) } : { left: snap.x, top: snap.y, width: snap.w, height: snap.h }) }} />}
              </div>
            );
          })()}
        </div>

        {review && (
          <div style={{ position: "relative", display: "flex", flex: "none", minHeight: 0 }}>
          <Resizer axis="x" grow={-1} value={sizes.review} min={260} max={() => Math.min(720, window.innerWidth * 0.5)} set={sizer("review")} reset={resetSize("review")} style={{ left: -4 }} />
          <ReviewPanel width={sizes.review} rv={review} q={revQ} setQ={setRevQ} ask={askReview} go={goFinding}
            rerun={() => runReview(review.scope, review.opt, repos.find((x) => x.id === review.repo))}
            close={() => { revTok.current++; setReview(null); setReportOpen(false); }}
            openReport={() => setReportOpen(true)}
            toggle={(id) => setReview((x) => ({ ...x, findings: x.findings.map((f) => (f.id === id ? { ...f, resolved: !f.resolved } : f)) }))} />
          </div>
        )}
      </div>

      {/* Status bar */}
      <div style={{ height: 26, flex: "none", display: "flex", alignItems: "center", gap: 14, whiteSpace: "nowrap", overflow: "hidden", padding: "0 12px", borderTop: "1px solid var(--line)", fontSize: 11.5, color: "var(--dim)" }}>
        <span style={{ color: "var(--soft)" }}>{r.id || "—"}</span>
        {r.git && r.branch && <span className="linkish mono" onClick={() => showOv("branch")} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}><I n="ph-git-branch" style={{ fontSize: 12 }} />{r.branch}</span>}
        {r.git && r.branch && <span className="linkish" onClick={push} title="Push" style={{ display: "flex", alignItems: "center", gap: 6 }}><I n="ph-arrows-down-up" style={{ fontSize: 12 }} />↓{cur.behind || 0} ↑{cur.ahead || 0}</span>}
        <div className="spacer" />
        {reg.status.map((it, i) => (
          <span key={it.plugin + i} className={it.run ? "linkish" : ""} title={it.title || it.plugin} onClick={() => it.run && Promise.resolve().then(it.run).catch((e) => say(`${it.plugin}: ${e}`, true))} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            {it.icon && <I n={it.icon} style={{ fontSize: 12 }} />}{it.text}
          </span>
        ))}
        {update && <button className="upd" onClick={runUpdate} title={update.body || ""}><I n="ph-download-simple" />Update to {update.version}</button>}
        <span style={{ display: "flex", alignItems: "center", gap: 6, height: 20, padding: "0 8px", borderRadius: 6, background: "color-mix(in srgb, var(--fg) 4%, transparent)", boxShadow: searchOpen ? "0 0 0 1px var(--acc-strong)" : "none" }}>
          <I n={searching ? "ph-circle-notch spin" : "ph-magnifying-glass"} style={{ fontSize: 12 }} />
          <input ref={searchBox} className="field" value={sq} onChange={(e) => setSq(e.target.value)} onFocus={() => hits && sq.trim() && setSearchOpen(true)}
            onKeyDown={(e) => { if (e.key === "Enter") search(); else if (e.key === "Escape") { setSearchOpen(false); e.currentTarget.blur(); } }}
            placeholder={`Search all repos  ${K}${SH}F`} style={{ width: 170, fontSize: 11.5 }} />
        </span>
        <span className="linkish mono" onClick={() => showOv("palette")} style={{ fontSize: 11 }}>{K}K</span>
        <span className="linkish" onClick={toggleTerm} style={{ display: "flex", alignItems: "center", gap: 5 }}><I n="ph-terminal-window" style={{ fontSize: 12 }} />Terminal</span>
        {floatsHidden && <span className="linkish" onClick={toggleFloats} title="Show popped-out terminals (⌃⇧`)" style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--acc-soft)" }}><I n="ph-eye" style={{ fontSize: 12 }} />{terms.filter((t) => t.float).length} hidden</span>}
        <span>{open ? LANG[open.path.split(".").pop()] || "Plain text" : "—"}</span>
        {user && <span style={{ display: "flex", alignItems: "center", gap: 6 }}><I n="ph-github-logo" style={{ fontSize: 12 }} />{user}</span>}
      </div>

      {/* Search results: floats above the status bar and stays open while you open hits */}
      {searchOpen && hits && (
        <div className="pop" style={{ position: "absolute", right: 12, bottom: 32, zIndex: 15, width: 560, maxWidth: "calc(100% - 24px)", height: "min(460px, 60%)", borderRadius: 10, display: "flex", flexDirection: "column", overflow: "hidden", animation: "rise .12s ease-out" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, height: 34, flex: "none", padding: "0 6px 0 14px", borderBottom: "1px solid color-mix(in srgb, var(--fg) 7%, transparent)", fontSize: 12 }}>
            <I n="ph-magnifying-glass" style={{ color: "var(--acc)" }} />
            <span className="ellip">{(() => { const n = Object.values(hits).reduce((a, l) => a + l.length, 0), m = Object.keys(hits).length; return n ? `${n} match${n > 1 ? "es" : ""} in ${m} repo${m > 1 ? "s" : ""}` : "No matches in the workfolder"; })()}</span>
            <div className="spacer" />
            <button className="ib" title="Close (Esc)" onClick={() => setSearchOpen(false)} style={{ color: "var(--dim)" }}><I n="ph-x" /></button>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "4px 0 8px" }}>
            {Object.entries(hits).map(([id, list]) => (
              <div key={id} style={{ marginBottom: 4 }}>
                <div style={{ display: "flex", gap: 6, padding: "8px 14px 4px", fontSize: 11.5, color: "var(--dimmer)" }}><span className="ellip">{id}</span><span>{list.length}</span></div>
                {list.map((h) => {
                  const on = open && open.repo === id && open.path === h.path && open.line === h.line;
                  return (
                    <div key={h.path + ":" + h.line} className="hov" onClick={() => openFile(id, h.path, "code", h.line)} onContextMenu={(e) => { const x = live.find((y) => y.id === id); if (x) openCtx(e, fileCtx(x, h.path)); }}
                      style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "3px 14px", background: on ? "color-mix(in srgb, var(--acc) 12%, transparent)" : undefined }}>
                      <span className="ellip" style={{ flex: "0 1 40%", minWidth: 0, fontSize: 11.5, color: "var(--dim)" }}>{h.path}<span style={{ color: "var(--dimmer)" }}>:{h.line}</span></span>
                      <span className="mono ellip" style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: "var(--soft)" }}>{h.text}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Branch switcher */}
      {ov === "branch" && r.id && (
        <>
          <div className="scrim" onClick={() => setOv(null)} style={{ zIndex: 20 }} />
          <div className="pop" style={{ position: "absolute", top: 56, left: "50%", transform: "translateX(-50%)", width: 440, maxWidth: "calc(100% - 32px)", zIndex: 21, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, height: 44, padding: "0 14px", borderBottom: "1px solid color-mix(in srgb, var(--fg) 7%, transparent)" }}>
              <I n="ph-git-branch" style={{ color: "var(--acc)", fontSize: 15 }} />
              <input autoFocus className="field" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") branchRows.length ? switchBranch(branchRows[0].name) : createBranch(); }} placeholder="Switch or create branch…" style={{ flex: 1, fontSize: 14 }} />
              <span style={{ fontSize: 11, color: "var(--dimmer)" }}>{r.id}</span>
            </div>
            <div style={{ maxHeight: 300, overflow: "auto", padding: 4 }}>
              {branchRows.map((b) => {
                const c = b.name === r.branch;
                return (
                  <div key={b.name} className="hov" onClick={() => switchBranch(b.name)} style={{ display: "flex", alignItems: "center", gap: 10, height: 32, padding: "0 10px", borderRadius: 6, background: c ? "color-mix(in srgb, var(--acc) 10%, transparent)" : undefined }}>
                    <I n={c ? "ph-check" : b.remote ? "ph-cloud" : ""} style={{ fontSize: 13, width: 14, color: "var(--acc)" }} />
                    <span className="mono" style={{ flex: 1, fontSize: 12.5, color: c ? "var(--fg)" : "var(--soft)" }}>{b.name}</span>
                    <span className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>{b.remote ? "remote" : b.ahead || b.behind ? `↑${b.ahead} ↓${b.behind}` : ""}</span>
                  </div>
                );
              })}
              {bq && !r.branches.some((b) => b.name.toLowerCase() === bq) && (
                <div className="hov" onClick={createBranch} style={{ display: "flex", alignItems: "center", gap: 10, height: 32, padding: "0 10px", borderRadius: 6, color: "var(--acc-fg)" }}>
                  <I n="ph-plus" style={{ fontSize: 13, width: 14 }} /><span>Create “{q.trim().replace(/\s+/g, "-")}” from {r.branch}</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Command palette */}
      {ov === "palette" && (
        <>
          <div className="scrim" onClick={() => setOv(null)} style={{ zIndex: 25, background: "rgba(10,11,18,0.35)" }} />
          <div className="pop" style={{ position: "absolute", top: 56, left: "50%", transform: "translateX(-50%)", width: 560, maxWidth: "calc(100% - 32px)", zIndex: 26, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, height: 48, padding: "0 16px", borderBottom: "1px solid color-mix(in srgb, var(--fg) 7%, transparent)" }}>
              <I n="ph-magnifying-glass" style={{ color: "var(--dim)", fontSize: 15 }} />
              <input autoFocus className="field" value={q} onChange={(e) => { setQ(e.target.value); setPIdx(0); }} placeholder="Files, commands, branches…" style={{ flex: 1, fontSize: 14.5 }}
                onKeyDown={(e) => {
                  const n = pItems.length;
                  if (e.key === "ArrowDown") { e.preventDefault(); setPIdx((pSel + 1) % n); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setPIdx((pSel - 1 + n) % n); }
                  else if (e.key === "Enter" && n) pItems[pSel].run();
                }} />
            </div>
            <div style={{ padding: 4, maxHeight: 360, overflow: "auto" }}>
              {pItems.map((it, i) => (
                <div key={it.label + (it.sub || "")} className="hov" onClick={it.run} onMouseMove={() => setPIdx(i)} style={{ display: "flex", alignItems: "center", gap: 10, height: 34, padding: "0 12px", borderRadius: 7, background: i === pSel ? "color-mix(in srgb, var(--acc) 12%, transparent)" : undefined, color: i === pSel ? "var(--fg)" : "var(--soft)" }}>
                  <I n={it.icon} style={{ fontSize: 14, color: "var(--dim)", width: 16 }} />
                  <span>{it.label}</span>
                  {it.sub && <span className="ellip" style={{ fontSize: 11.5, color: "var(--dimmer)", minWidth: 0 }}>{it.sub}</span>}
                  <span className="spacer" />
                  <span className="mono" style={{ fontSize: 11, color: "var(--dimmer)" }}>{it.hint}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Add repository */}
      {ov === "add" && (
        <>
          <div className="scrim" onClick={() => setOv(null)} style={{ zIndex: 30, background: "rgba(10,11,18,0.6)" }} />
          <div className="pop" style={{ position: "absolute", top: "12%", left: "50%", transform: "translateX(-50%)", width: 540, maxWidth: "calc(100% - 32px)", zIndex: 31, borderRadius: 14, display: "flex", flexDirection: "column", maxHeight: "76%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 20px 14px" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 500 }}>Add to workfolder</div>
                <div style={{ fontSize: 12, color: "var(--mid)", marginTop: 3 }}>{addTab === "local" ? "Links" : "Clones"} into <span className="mono" style={{ color: "var(--soft)" }}>{root}</span></div>
              </div>
              {seg([["GitHub", addTab === "github", () => showAddTab("github")], ["URL", addTab === "url", () => showAddTab("url")], ["Local folder", addTab === "local", () => showAddTab("local")]])}
            </div>
            {addTab === "github" && (
              <>
                <div style={{ padding: "0 20px 10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, height: 34, padding: "0 10px", borderRadius: 8, background: "color-mix(in srgb, var(--bg) 70%, transparent)", boxShadow: "0 0 0 1px var(--border)" }}>
                    <I n="ph-magnifying-glass" style={{ color: "var(--dim)" }} />
                    <input autoFocus className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder={user ? `Search ${user} and your orgs` : "Search your repositories"} style={{ flex: 1, fontSize: 13 }} />
                  </div>
                </div>
                <div style={{ overflow: "auto", padding: "0 12px 12px", minHeight: 0 }}>
                  {!ghRepos && <div style={{ padding: 8, color: "var(--dim)", display: "flex", gap: 8, alignItems: "center" }}><I n="ph-circle-notch spin" />Loading repositories…</div>}
                  {ghRepos && !ghRepos.length && <div style={{ padding: 8, color: "var(--dim)" }}>No repositories found. Is <span className="mono">gh</span> signed in? Use the URL tab otherwise.</div>}
                  {(ghRepos || []).filter((g) => !aq || (g.owner + "/" + g.name).toLowerCase().includes(aq)).slice(0, 100).map((g) => {
                    const ex = repos.find((x) => x.id === g.name);
                    return (
                      <div key={g.owner + "/" + g.name} className="hov" style={{ display: "flex", alignItems: "center", gap: 12, padding: 8, borderRadius: 8, cursor: "default" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="ellip"><span style={{ color: "var(--dim)" }}>{g.owner}/</span><span style={{ fontWeight: 500 }}>{g.name}</span></div>
                          <div style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 2 }}>{g.meta}</div>
                        </div>
                        {ex && !ex.parked && <span style={{ fontSize: 11.5, color: "var(--dim)", display: "flex", alignItems: "center", gap: 5 }}><I n="ph-check" />In workfolder</span>}
                        {ex?.parked && <button className="btn" onClick={() => park(g.name, false)} style={{ height: 26, borderRadius: 7, fontSize: 12, borderColor: "var(--dimmer)", color: "var(--code)" }}><I n="ph-arrow-line-up" />From reserve</button>}
                        {!ex && (cloning.includes(g.name)
                          ? <span style={{ fontSize: 11.5, color: "var(--dim)", display: "flex", alignItems: "center", gap: 5 }}><I n="ph-circle-notch spin" />Cloning…</span>
                          : <button className="btn" onClick={() => cloneGh(g)} style={{ height: 26, borderRadius: 7, fontSize: 12 }}>Clone</button>)}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {addTab === "local" && (
              <div style={{ overflow: "auto", padding: "0 12px 16px", minHeight: 0 }}>
                {!localDirs && <div style={{ padding: 8, color: "var(--dim)", display: "flex", gap: 8, alignItems: "center" }}><I n="ph-circle-notch spin" />Looking for folders…</div>}
                {(localDirs || []).map((lf) => {
                  const added = repos.some((x) => x.id === lf.name);
                  return (
                    <div key={lf.abs} className="hov" style={{ display: "flex", alignItems: "center", gap: 12, padding: 8, borderRadius: 8, cursor: "default" }}>
                      <I n={lf.git ? "ph-folder-simple" : "ph-folder-simple-dashed"} style={{ fontSize: 18, color: "var(--dim)" }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500 }}>{lf.name}</div>
                        <div className="ellip" style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 2 }}><span className="mono" style={{ fontSize: 11 }}>{lf.path}</span> · {lf.git ? "git" : "folder"} · edited {ago(lf.edited)}</div>
                      </div>
                      {added ? <span style={{ fontSize: 11.5, color: "var(--dim)", display: "flex", alignItems: "center", gap: 5 }}><I n="ph-check" />Name taken</span>
                        : <button className="btn" onClick={() => addLocal(lf.abs)} style={{ height: 26, borderRadius: 7, fontSize: 12 }}>Add</button>}
                    </div>
                  );
                })}
                <div className="hov" onClick={chooseFolder} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 8px", marginTop: 4, borderRadius: 8, color: "var(--mid)", boxShadow: "inset 0 0 0 1px var(--border)" }}><I n="ph-folder-open" style={{ fontSize: 18 }} /><span>Choose another folder…</span></div>
                <div style={{ marginTop: 10, padding: "0 8px", fontSize: 12, color: "var(--dim)", lineHeight: 1.5 }}>Folders are linked into {root}, not moved. Plain folders stay plain until you initialize git.</div>
              </div>
            )}
            {addTab === "url" && (
              <div style={{ padding: "4px 20px 20px" }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <input autoFocus className="mono" value={urlVal} onChange={(e) => setUrlVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && cloneUrl()} placeholder="https://github.com/owner/repo.git"
                    style={{ flex: 1, height: 34, padding: "0 10px", borderRadius: 8, border: 0, background: "color-mix(in srgb, var(--bg) 70%, transparent)", boxShadow: "0 0 0 1px var(--border)", outline: "none", color: "var(--fg)", fontSize: 12.5 }} />
                  <button className="btn" onClick={cloneUrl} disabled={!urlParts} style={{ height: 34 }}>Clone</button>
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: "var(--dim)" }}>Destination <span className="mono" style={{ color: "var(--soft)" }}>{root}/{urlParts ? urlParts[2] : "repo"}</span></div>
              </div>
            )}
          </div>
        </>
      )}

      {ov === "keys" && (
        <>
          <div className="scrim" onClick={() => setOv(null)} style={{ zIndex: 25, background: "rgba(10,11,18,0.35)" }} />
          <div className="pop" style={{ position: "absolute", top: 56, left: "50%", transform: "translateX(-50%)", width: 400, maxWidth: "calc(100% - 32px)", zIndex: 26, borderRadius: 12, padding: "18px 22px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 500, marginBottom: 14 }}><I n="ph-keyboard" style={{ color: "var(--acc)" }} />Keyboard shortcuts</div>
            <div className="keys">{keyRows}</div>
          </div>
        </>
      )}

      {ov === "multi" && (
        <>
          <div className="scrim" onClick={() => setOv(null)} style={{ zIndex: 30, background: "rgba(10,11,18,0.6)" }} />
          <div className="pop" style={{ position: "absolute", top: "12%", left: "50%", transform: "translateX(-50%)", width: 480, maxWidth: "calc(100% - 32px)", zIndex: 31, borderRadius: 14, padding: "18px 20px 20px", display: "flex", flexDirection: "column", gap: 12, maxHeight: "76%", overflow: "auto" }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 500 }}>Commit across repos</div>
              <div style={{ fontSize: 12, color: "var(--mid)", marginTop: 3 }}>One message in every repo you tick. Where files are staged only those go in, otherwise everything.</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {!dirtyRepos.length && <div style={{ color: "var(--dim)" }}>No uncommitted changes in the workfolder.</div>}
              {dirtyRepos.map((x) => {
                const on = mc.pick.includes(x.id);
                return (
                  <div key={x.id} className="linkish" onClick={() => setMc((m) => ({ ...m, pick: on ? m.pick.filter((y) => y !== x.id) : [...m.pick, x.id] }))} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: on ? "var(--fg)" : "var(--dim)", minWidth: 0 }}>
                    <Check on={on} /><span style={{ flex: "none" }}>{x.id}</span><span className="mono ellip" style={{ fontSize: 11, color: "var(--acc-soft)", minWidth: 0 }}>{x.branch}</span>
                    <span className="spacer" /><span style={{ fontSize: 11, color: "var(--mod)", flex: "none" }}>{x.changes.some((c) => c.staged) ? `${x.changes.filter((c) => c.staged).length} staged` : `${x.changes.length} change${x.changes.length > 1 ? "s" : ""}`}</span>
                  </div>
                );
              })}
            </div>
            <textarea autoFocus value={mc.msg} onChange={(e) => setMc((m) => ({ ...m, msg: e.target.value }))} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); multiCommit(); } }} placeholder={`Commit message  (${K}Enter)`} rows={3}
              style={{ display: "block", width: "100%", resize: "none", background: "color-mix(in srgb, var(--bg) 70%, transparent)", border: 0, boxShadow: "0 0 0 1px var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--fg)", fontSize: 13, lineHeight: "18px", outline: "none" }} />
            <input className="mono" value={mc.branch} onChange={(e) => setMc((m) => ({ ...m, branch: e.target.value }))} placeholder="Branch (optional): switch to or create it first"
              style={{ height: 32, padding: "0 10px", borderRadius: 8, border: 0, background: "color-mix(in srgb, var(--bg) 70%, transparent)", boxShadow: "0 0 0 1px var(--border)", outline: "none", color: "var(--fg)", fontSize: 12.5 }} />
            <div className="linkish" onClick={() => setMc((m) => ({ ...m, pr: !m.pr }))} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--soft)" }}><Check on={mc.pr} />Push and open pull requests that link to each other</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn" disabled={!mc.msg.trim() || !mc.pick.some((id) => dirtyRepos.some((x) => x.id === id))} onClick={multiCommit} style={{ flex: 1 }}>Commit in {dirtyRepos.filter((x) => mc.pick.includes(x.id)).length} repos</button>
              <button className="ghost" onClick={() => setOv(null)} style={{ height: 30 }}>Cancel</button>
            </div>
          </div>
        </>
      )}

      {asking && (
        <>
          <div className="scrim" onClick={() => setAsking(null)} style={{ zIndex: 70, background: "rgba(10,11,18,0.45)" }} />
          <form className="pop" onSubmit={(e) => { e.preventDefault(); asking.ok(e.target.elements.name.value); setAsking(null); }}
            style={{ position: "absolute", top: "22%", left: "50%", transform: "translateX(-50%)", width: 360, maxWidth: "calc(100% - 32px)", zIndex: 71, padding: 18 }}>
            <div style={{ fontWeight: 500, marginBottom: 12 }}>{asking.title}</div>
            <input name="name" autoFocus defaultValue={asking.value} placeholder={asking.placeholder || "Name"} onKeyDown={(e) => e.key === "Escape" && setAsking(null)}
              style={{ width: "100%", height: 34, padding: "0 10px", borderRadius: 8, border: 0, background: "color-mix(in srgb, var(--bg) 70%, transparent)", boxShadow: "0 0 0 1px var(--border)", outline: "none", color: "var(--fg)", fontSize: 13 }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 14 }}>
              <button type="button" className="ghost" onClick={() => setAsking(null)} style={{ height: 30 }}>Cancel</button>
              <button type="submit" className="btn">Save</button>
            </div>
          </form>
        </>
      )}

      {ctx && (
        <>
          <div onClick={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null); }} style={{ position: "fixed", inset: 0, zIndex: 50 }} />
          <div className="pop" style={{ position: "fixed", left: ctx.x, top: ctx.y, zIndex: 51, minWidth: 210, padding: 4, borderRadius: 8, animation: "rise .1s ease-out" }}>
            {ctx.items.map((m, i) => m.sep
              ? <div key={i} style={{ height: 1, margin: "4px 6px", background: "color-mix(in srgb, var(--fg) 7%, transparent)" }} />
              : <div key={i} className="ctx" onClick={() => { if (m.disabled) return; setCtx(null); m.run(); }} style={{ color: m.danger ? "var(--del)" : "var(--code)", opacity: m.disabled ? 0.4 : 1 }}>
                  <I n={m.icon} style={{ fontSize: 14, width: 14, color: m.danger ? "var(--del)" : "var(--dim)" }} /><span style={{ flex: 1, whiteSpace: "nowrap" }}>{m.label}</span><span className="mono" style={{ fontSize: 11, color: "var(--dimmer)" }}>{m.hint}</span>
                </div>)}
          </div>
        </>
      )}

      {whatsNew && !wizard && <Changelog since={whatsNew.since} current={whatsNew.current} close={() => setWhatsNew(null)} />}
      {settingsOpen && <Settings close={() => { setSettingsOpen(false); setDiffStyle(settings.diffStyle); }} say={say} openWizard={() => setWizard(true)} reload={load} whatsNew={() => { setSettingsOpen(false); showWhatsNew(); }}
        groups={groups} newGroup={() => newGroup()} renameGroup={renameGroup} deleteGroup={deleteGroup} changed={() => setTick((t) => t + 1)}
        update={update} runUpdate={() => { setSettingsOpen(false); runUpdate(); }}
        checkNow={(quiet) => { if (!quiet) say("Checking for updates…"); return checkUpdate(15000).then((u) => { if (u) setUpdate(u); if (!quiet) say(u ? `Nimbus ${u.version} is available` : "You're on the latest version"); }); }} />}
      {wizard && <Wizard done={finishWizard} addRepos={openAdd} />}
      {updating && <Splash label={`Updating to ${update.version}`} sub={updating.p >= 1 ? "Restarting…" : "Downloading…"} progress={updating.p} />}

      {toast && (
        <div style={{ position: "absolute", right: 16, bottom: 40, zIndex: 40, maxWidth: "min(560px, calc(100% - 32px))", display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderRadius: 8, background: "var(--pop)", boxShadow: "0 0 0 1px var(--dimmer),0 6px 18px rgba(0,0,0,0.55)", fontSize: 12.5, animation: "rise .16s ease-out" }}>
          <span style={{ width: 6, height: 6, flex: "none", borderRadius: "50%", background: toast.err ? "var(--del)" : "var(--acc)", boxShadow: `0 0 8px ${toast.err ? "var(--del)" : "var(--acc)"}` }} />
          <span className="ellip">{toast.t}</span>
        </div>
      )}
    </div>
  );
}
