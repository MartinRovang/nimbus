import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit as emitEvent, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as pickFolder, confirm as ask } from "@tauri-apps/plugin-dialog";
import Wizard from "./Wizard.jsx";
import Settings from "./Settings.jsx";
import Changelog from "./Changelog.jsx";
import { getVersion } from "@tauri-apps/api/app";
import { store, settings, saveSettings, SIZES } from "./settings.js";
import { reg, subscribe, host, emit } from "./plugins.js";
import { Splash, checkUpdate, install } from "./Boot.jsx";
import { SEV, ReviewPanel, Report, reportMarkdown } from "./Review.jsx";
import { I, Resizer, seg, ST, K, SH, keyRows, EMPTY, ISSUE_FIELDS, PR_FIELDS, git, gh, mainOf } from "./ui.jsx";
import { FilesPanel, GitPanel, IssuesPanel, PrsPanel, StatusBar } from "./Panels.jsx";
import { CodeView, PRPage, IssuePage, ReserveHome, Onboarding, ProjectHome } from "./Main.jsx";
import { Terminals } from "./Terminals.jsx";
import { SearchResults, BranchSwitcher, Palette, AddRepo, KeysDialog, MultiCommit, NewProject, Tour, AskName, ReviewerPicker, ContextMenu, Toast } from "./Overlays.jsx";
import REPORT_HTML from "./report.html?raw";
import { parseDiff, ago, mapPR, reserveGroups, othersActive, snapZone, cellRect, overlaps, parseGrep, mapIssue, projectMd, reportSeed, withRepos, claudeCmd, KICKOFF } from "./lib.js";

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
  const [tour, setTour] = useState(() => !store.get("nb.tourDone", false)); // once, after the welcome; again from Settings or the palette
  const [whatsNew, setWhatsNew] = useState(null);
  const [used, setUsed] = useState(() => store.get("nb.used", {})); // repo id -> when it was last the active repo
  const [groups, setGroupsState] = useState(settings.groups); // your own reserve groups: [{ name, repos }]
  const [collapsed, setCollapsed] = useState(settings.collapsed); // group keys folded shut
  const [, setTick] = useState(0); // re-render after Settings changes something read straight from `settings`
  const [asking, setAsking] = useState(null); // { title, value, ok(name) }: the small naming dialog
  const [inProject, setInProject] = useState(() => store.get("nb.project", null)); // { id, before }: focused on a project; before = repos out until then
  const [proj, setProj] = useState(null); // "Start a project" dialog: { edit: project id or null, init: its .nimbus-project.json }
  // First start on a new version: show what changed since the one last seen. A fresh install shows nothing.
  useEffect(() => {
    getVersion().then((v) => {
      const last = store.get("nb.lastVersion", null);
      store.set("nb.lastVersion", v);
      if (last !== v && (last || store.get("nb.setupDone", false))) setWhatsNew({ since: last, current: v });
    }, () => {});
  }, []);
  const startTour = () => { setSettingsOpen(false); setPanelRaw("files"); setTour(true); };
  const endTour = useCallback(() => { store.set("nb.tourDone", true); setTour(false); }, []);
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
      ? invoke("park_all").then((ids) => { if (ids.length) { setLastSet(ids); store.set("nb.lastSet", ids); } setInProject(null); store.set("nb.project", null); }, () => {})
      : Promise.resolve();
    parkedAtStart = true;
    start.then(load);
    gh(null, "api", "user", "--jq", ".login").then((u) => setUser(u.trim()), () => {});
    // alt-tabbing back re-reads every repo (~6 git processes each); at most once per 5 s
    let last = 0;
    const onFocus = () => { if (Date.now() - last > 5000) { last = Date.now(); load(); } };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
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

  // PRs and issues load `light` (numbers and states, enough for the rail badges and the "Open PR" button) until
  // their tab is opened; bodies, files, checks and comments only then. `full` holds the repos loaded in full,
  // so a slow light reply never overwrites a full list.
  const full = useRef({ prs: new Set(), issues: new Set() });
  const loadPRs = useCallback(async (id, quiet, light) => {
    let list = [], failed = false;
    try { list = JSON.parse(await gh(id, "pr", "list", "--state", "all", "--limit", "30", "--json", light ? "number,state,isDraft,headRefName" : PR_FIELDS)).map(mapPR); }
    catch (e) { failed = true; if (!quiet) say(e, true); }
    if (!light) full.current.prs.add(id);
    else if (full.current.prs.has(id)) return;
    setPrs((p) => (failed && p[id] ? p : { ...p, [id]: list })); // a failed refresh keeps what was there
  }, [say]);
  // loaded quietly for the active repo too, so the rail can show how many PRs are open
  useEffect(() => { if (r.id && (panel === "prs" || r.remote) && !prs[r.id]) loadPRs(r.id, panel !== "prs", panel !== "prs"); }, [panel, r.id, r.remote, prs, loadPRs]);
  // with several GitHub repos in the workspace the panel lists all of them, grouped by repo
  // (worktrees share their repo's PRs, so they are left out)
  const ghLive = live.filter((x) => x.remote && !x.worktree);
  const prRepos = ghLive.length > 1 ? ghLive.sort((a, b) => a.id.localeCompare(b.id)) : r.id ? [r] : [];
  const issuesAsked = useRef(new Set()); // repos whose issues were fetched (or are being), so the effect below asks once
  const loadIssues = useCallback(async (id, quiet, light) => {
    issuesAsked.current.add(id);
    let list = [], failed = false;
    try { list = JSON.parse(await gh(id, "issue", "list", "--state", "all", "--limit", "30", "--json", light ? "number,state" : ISSUE_FIELDS)).map(mapIssue); }
    catch (e) { failed = true; if (!quiet) say(e, true); }
    if (!light) full.current.issues.add(id);
    else if (full.current.issues.has(id)) return;
    setIssues((s) => (failed && s[id] ? s : { ...s, [id]: list }));
  }, [say]);
  // loaded even with the panel closed so the rail badge can sum open PRs across the workspace
  useEffect(() => { for (const x of prRepos) if (!prs[x.id]) loadPRs(x.id, true, true); }, [prRepos.map((x) => x.id).join(" "), prs, loadPRs]); // eslint-disable-line react-hooks/exhaustive-deps
  // opening a tab upgrades its repos to full lists
  useEffect(() => {
    for (const x of prRepos) {
      if (panel === "prs" && !full.current.prs.has(x.id)) loadPRs(x.id, true);
      if (panel === "issues" && x.remote && !full.current.issues.has(x.id)) loadIssues(x.id, true);
    }
  }, [panel, prRepos.map((x) => x.id).join(" "), loadPRs, loadIssues]); // eslint-disable-line react-hooks/exhaustive-deps
  // issues the same way, from the same repos (worktrees left out)
  useEffect(() => { for (const x of prRepos) if (x.remote && !issuesAsked.current.has(x.id)) loadIssues(x.id, true, true); }, [prRepos.map((x) => x.id).join(" "), loadIssues]); // eslint-disable-line react-hooks/exhaustive-deps
  // ponytail: PRs and issues re-fetched every 10 min like the git fetch above; 2 gh calls per repo, full lists stay full
  const prIds = prRepos.filter((x) => x.remote).map((x) => x.id).join(" ");
  useEffect(() => {
    if (!prIds) return;
    const t = setInterval(() => prIds.split(" ").forEach((id) => {
      loadPRs(id, true, !full.current.prs.has(id));
      loadIssues(id, true, !full.current.issues.has(id));
    }), 10 * 60 * 1000);
    return () => clearInterval(t);
  }, [prIds, loadPRs, loadIssues]);

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
    // ponytail: first 300 hits per repo; paging if people search for "the". No --max-count: git < 2.38 rejects it
    const found = await Promise.all(live.map((x) => git(x.id, "grep", "-n", "-z", "-I", "-i", "-F", x.git ? "--untracked" : "--no-index", "-e", s)
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
    if (!parkIt && repos.find((x) => x.id === id)?.project) return enterProject(id);
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
  // who can review = who can be assigned; fetched once per repo, and a failed fetch just leaves free typing
  const [reviewAsk, setReviewAsk] = useState(null); // { p, rp }
  const people = useRef({});
  const [, setPeopleTick] = useState(0); // re-renders once the list arrives
  const requestReview = (p, rp = r) => {
    setReviewAsk({ p, rp });
    people.current[rp.id] ??= gh(rp.id, "api", `repos/${rp.remote}/assignees`, "--paginate", "--jq", ".[].login")
      .then((out) => out.split("\n").filter(Boolean), () => []).then((l) => { people.current[rp.id] = l; setPeopleTick((t) => t + 1); });
  };
  const sendReview = (who) => {
    const { p, rp } = reviewAsk;
    setReviewAsk(null);
    if (who.length) prAct(() => gh(rp.id, "pr", "edit", String(p.num), "--add-reviewer", who.join(",")), `Asked ${who.join(", ")} to review #${p.num}`, rp.id);
  };

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
    if (rp.remote && !prs[rp.id]) loadPRs(rp.id, true, true);
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

  // Each terminal belongs to the project focused when it opened (null: none). Only that project's terminals show,
  // docked, popped out or on the other screen; the others keep running out of sight until you switch back.
  const here = (t) => (t.project ?? null) === (inProject?.id ?? null);
  const termsHere = terms.filter(here);
  // the store, not inProject: enterProject stores the new project before this render's state catches up
  const curProject = () => store.get("nb.project", null)?.id ?? null;

  // ---- context menus ----
  const openCtx = (e, items) => {
    e.preventDefault(); e.stopPropagation();
    items = items.filter(Boolean);
    const n = termsHere.filter((t) => t.float).length;
    if (n) items = [...items, items.length && { sep: true }, { icon: floatsHidden ? "ph-eye" : "ph-eye-slash", label: floatsHidden ? `Show popped-out terminals (${n})` : "Hide popped-out terminals", hint: "⌃⇧`", run: toggleFloats }].filter(Boolean);
    if (!items.length) return;
    const h = items.filter((i) => !i.sep).length * 28 + items.filter((i) => i.sep).length * 9 + 8;
    setCtx({ x: Math.max(4, Math.min(e.clientX, window.innerWidth - 236)), y: Math.max(4, Math.min(e.clientY, window.innerHeight - h - 8)), items });
  };
  const copy = (t) => navigator.clipboard.writeText(t).then(() => say("Copied " + (t.length > 48 ? t.slice(0, 46) + "…" : t)), (e) => say(e, true));
  const absPath = (id, path) => [wf?.abs, id, path].filter(Boolean).join("/");
  const ghLink = (rp, path) => `https://github.com/${rp.remote}/blob/${rp.branch}/${path}`;
  const termHere = termsHere.some((x) => x.float) ? { icon: "ph-arrow-square-out", label: "Pop out a terminal here" } : { icon: "ph-terminal", label: "Open terminal here" };
  // with terminals already popped out, a new one pops out too, into the next free cell
  const termIn = (id) => {
    const t = ++tid.current, float = termsHere.some((x) => x.float) ? placeFloat() : null;
    if (float) setFloatsHidden(false);
    setTerms((ts) => [...ts, { id: t, repo: id, float, project: curProject() }]);
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
      x.project && { icon: "ph-sparkle", label: "Start Claude here…", run: () => claudeIn(x.id) },
      x.project && (inProject?.id === x.id ? { icon: "ph-sign-out", label: "Exit project", run: exitProject } : { icon: "ph-sign-in", label: "Focus on this project", run: () => enterProject(x.id) }),
      x.project && { icon: "ph-plus", label: "Add repos to project…", run: () => addToProject(x) },
      x.project && { icon: "ph-browser", label: "Open report", run: () => openReport(x.id) },
      !x.project && { icon: "ph-git-commit", label: "Initialize git repository", run: () => initGit(x.id) },
      { ...termHere, run: () => termIn(x.id) },
      { sep: true },
      { icon: "ph-copy", label: "Copy path", run: () => copy(x.src || absPath(x.id)) },
      { icon: "ph-folder-open", label: "Open containing folder", run: () => reveal(x.id) },
      { sep: true },
      { icon: "ph-arrow-line-down", label: "Move to reserve", run: () => park(x.id, true) },
      x.src && { icon: "ph-link-break", label: "Remove from workfolder", danger: true, run: () => unlinkRepo(x.id) },
      x.project && { icon: "ph-trash", label: "Delete project", danger: true, run: () => deleteProject(x) },
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
  // ---- projects: a folder with repos linked inside and a CLAUDE.md on how Claude reports back ----
  const startProject = () => { setProj({ edit: null }); showOv("project"); };
  const addToProject = async (x) => {
    const init = await invoke("read_file", { id: x.id, path: ".nimbus-project.json" }).then(JSON.parse).catch(() => ({}));
    setProj({ edit: x.id, init }); showOv("project");
  };
  const saveProject = async (p, claude) => {
    const id = proj.edit || p.name, ids = [...new Set([...(proj.init?.repos || []), ...p.repos.map((x) => x.id)])];
    try {
      const md = proj.edit ? withRepos(await invoke("read_file", { id, path: "CLAUDE.md" }), repos.filter((x) => ids.includes(x.id))) : projectMd(p);
      const cfg = proj.edit ? { ...proj.init, repos: ids } : { goal: p.goal, report: p.report, repos: ids, phase: "start" };
      const files = { "CLAUDE.md": md, ".nimbus-project.json": JSON.stringify(cfg, null, 2) + "\n" };
      if (!proj.edit && p.report.kind === "html") Object.assign(files, { "REPORT.html": REPORT_HTML, "REPORT.json": JSON.stringify(reportSeed(p), null, 2) + "\n" });
      await invoke("save_project", { name: id, repos: ids, files });
      setOv(null);
      if (proj.edit) { await load(); setActive(id); say(`Added to ${id}`); }
      else await enterProject(id, `Started ${id} in ${root}/${id}`);
      if (claude !== false) newTerm(claudeCmd(claude, mcpExe), id);
    } catch (e) { say(e, true); }
  };
  // an issue project's report is its issue; Claude fills in report.issue when it had to open one
  const openReport = async (id) => {
    const { report } = await invoke("read_file", { id, path: ".nimbus-project.json" }).then(JSON.parse).catch(() => ({}));
    if (report?.kind !== "issue") return invoke("open_report", { id }).catch((e) => say(e, true));
    if (!report.issue) return say("No issue yet: Claude opens one when it starts work", true);
    invoke("open_url", { url: `https://github.com/${report.repo}/issues/${report.issue}` }).catch((e) => say(e, true));
  };
  // Focus: only the project and its repos stay out; the rest go to reserve until you exit
  const onlyOut = async (ids) => {
    await invoke("park_all").catch(() => {});
    for (const id of ids) await invoke("set_parked", { id, parked: false }).catch(() => {});
  };
  const enterProject = async (id, msg) => {
    const { repos: ids = [] } = await invoke("read_file", { id, path: ".nimbus-project.json" }).then(JSON.parse).catch(() => ({}));
    const p = { id, before: inProject?.before ?? live.map((x) => x.id) }; // switching projects keeps what to go back to
    await onlyOut([id, ...ids]);
    setInProject(p); store.set("nb.project", p);
    setOpen(null); setOpenPR(null); setOpenIssue(null); setOv(null);
    await load(); setActive(id); setPanelRaw("files");
    say(msg || `Focused on ${id}; the rest wait in reserve`);
  };
  const exitProject = async () => {
    const { id, before } = inProject;
    await onlyOut(before);
    setInProject(null); store.set("nb.project", null);
    setOpen(null); setOpenPR(null); setOpenIssue(null);
    await load(); setActive(before[0] || "");
    say(`Left ${id}` + (before.length ? `; ${before.length} repo${before.length > 1 ? "s" : ""} back out` : ""));
  };
  const deleteProject = async (x) => {
    if (!window.confirm(`Delete the project ${x.id}?\n\nIts folder, CLAUDE.md and REPORT.html go. The repos stay in the workfolder.`)) return;
    // read before the folder goes: an open report issue can be closed with it
    const { report: rp } = await invoke("read_file", { id: x.id, path: ".nimbus-project.json" }).then(JSON.parse).catch(() => ({}));
    const issueOpen = rp?.kind === "issue" && rp.issue && (await gh(null, "issue", "view", String(rp.issue), "--repo", rp.repo, "--json", "state", "--jq", ".state").catch(() => "")).trim() === "OPEN";
    const close = issueOpen && window.confirm(`Also close the report issue ${rp.repo}#${rp.issue}?`);
    if (inProject?.id === x.id) await exitProject();
    try { await invoke("remove_repo", { id: x.id }); } catch (e) { return say(e, true); }
    await load();
    if (!close) return say("Deleted project " + x.id);
    gh(null, "issue", "close", String(rp.issue), "--repo", rp.repo, "--comment", `Project ${x.id} is done and was deleted in Nimbus.`)
      .then(() => say(`Deleted project ${x.id} and closed ${rp.repo}#${rp.issue}`), (e) => say(`Deleted project ${x.id}, but closing the issue failed: ${e}`, true));
  };
  const showProject = (id) => { setOpen(null); setOpenPR(null); setOpenIssue(null); setActive(id); };
  const claudeIn = (id) => setAsking({ title: `Start Claude in ${id}`, placeholder: "First message (empty: none)", value: KICKOFF, okLabel: "Start", ok: (m) => newTerm(claudeCmd(m, mcpExe), id) });
  const reserveCtx = (x) => x.project ? [
    { icon: "ph-sign-in", label: "Focus on this project", run: () => enterProject(x.id) },
    { sep: true },
    { icon: "ph-trash", label: "Delete project", danger: true, run: () => deleteProject(x) },
  ] : [
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
    p.state === "open" && { icon: "ph-user-plus", label: "Request review…", run: () => requestReview(p, rp) },
    p.url && { icon: "ph-chat-circle-dots", label: "Add PR link to a new Claude chat", run: () => newTerm("claude\r" + p.url + " ", rp.id) },
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
  const mine = (t) => here(t) && (!t.repo || t.repo === r.id);
  const newTerm = (cmd, repo) => {
    const id = ++tid.current;
    if (repo && live.some((x) => x.id === repo)) setActive(repo);
    setTerms((t) => [...t, { id, repo: repo ?? (live.length ? r.id : null), cmd: typeof cmd === "string" ? cmd : "", project: curProject() }]);
    setTermOpen(true); setOv(null);
  };
  // Ctrl+` shows or hides the docked terminals; popped-out ones stay where they are
  const toggleTerm = () => (dual ? newTerm() : terms.some((t) => !t.float && mine(t)) ? setTermOpen((o) => !o) : newTerm());
  const closeTerm = (id) => {
    invoke("pty_close", { tab: id });
    setTerms((ts) => {
      const rest = ts.filter((t) => t.id !== id);
      if (!rest.some((t) => !t.float)) setTermOpen(false);
      return rest;
    });
  };
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
    const n = termsHere.filter((x) => x.float && !x.float.snapped).length, w = Math.min(720, a.w - 16), h = Math.min(360, a.h - 16);
    return { x: Math.round(a.x + (a.w - w) / 2 + n * 28), y: Math.round(a.y + (a.h - h) / 2 + n * 28), w, h, ...base };
  };
  const popOut = (t) => { setFloat(t.id, placeFloat()); setFloatsHidden(false); };
  // Ctrl+Shift+` or any right-click menu: tuck every popped-out terminal away (shells keep running) and bring them back
  const [floatsHidden, setFloatsHidden] = useState(false);
  const toggleFloats = () => (termsHere.some((t) => t.float) ? setFloatsHidden((h) => !h) : say("No popped-out terminals"));
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

  // ---- dual screen: every terminal in a window of its own (TermWindow) for a second monitor; App keeps the list ----
  const dual = !!settings.dualScreen;
  const setDual = (on) => { saveSettings({ dualScreen: on }); setTick((n) => n + 1); if (on && !terms.length) newTerm(); };
  const termsWin = () => WebviewWindow.getByLabel("terms");
  const focusTerms = () => termsWin().then((w) => w?.setFocus());
  useEffect(() => {
    if (!dual) { termsWin().then((w) => w?.close()); return; }
    termsWin().then((w) => {
      if (!settings.dualScreen) return; // switched off again while we looked
      if (w) return w.setFocus();
      const g = store.get("nb.termsWin", {});
      new WebviewWindow("terms", { url: "index.html?view=terms", title: "Nimbus — Terminals", width: g.w ?? 1100, height: g.h ?? 760, minWidth: 480, minHeight: 320, ...(g.x != null && { x: g.x, y: g.y }) });
    });
  }, [dual]); // eslint-disable-line react-hooks/exhaustive-deps
  // the list, plus the repos the terminals window can open a terminal in (preset to the active one)
  const termsNow = useRef();
  termsNow.current = { terms: termsHere, repos: live.map((x) => x.id), active: live.length ? r.id : null };
  const sendTerms = () => { const n = termsNow.current; emitEvent("nb-terms", { ...n, terms: n.terms.map(({ id, repo, cmd }) => ({ id, repo, cmd })) }); };
  useEffect(() => { if (dual) sendTerms(); }, [dual, terms, inProject?.id, termsNow.current.repos.join("\n"), termsNow.current.active]); // eslint-disable-line react-hooks/exhaustive-deps
  // what Claude asks for through `nimbus mcp`; refresh and show also reach the project page as `mcp`
  const [mcp, setMcp] = useState(null), [mcpExe, setMcpExe] = useState(null);
  useEffect(() => { invoke("mcp_exe").then(setMcpExe, () => {}); }, []);
  // agent state per repo from `nimbus hook` / the set_status tool; the sidebar shows it while the repo has a terminal
  const [agent, setAgent] = useState({});
  const mcpDo = (m) => {
    if (m.do === "status") setAgent((a) => ({ ...a, [m.repo]: m.state === "idle" ? undefined : m }));
    else if (m.do === "notify") say(`${m.project}: ${m.text}`);
    else if (m.do === "open_file") openFile(m.repo, m.path, "code", m.line ?? undefined);
    else { if (m.do === "show") showProject(m.project); setMcp({ ...m, t: Date.now() }); }
  };
  const fromTerms = useRef();
  fromTerms.current = { newTerm, closeTerm, termEnter, setDual, sendTerms, mcpDo };
  useEffect(() => {
    const on = (name, f) => listen(name, (e) => f(fromTerms.current, e.payload));
    const un = [
      // a terms window left over from a quick on/off would take the shells from this window's terminals: close it
      on("nb-terms-hello", (h) => (settings.dualScreen ? h.sendTerms() : WebviewWindow.getByLabel("terms").then((w) => w?.close()))),
      on("nb-term-new", (h, p) => h.newTerm("", p?.repo ?? undefined)),
      on("nb-term-close", (h, p) => h.closeTerm(p.id)),
      on("nb-term-enter", (h, p) => h.termEnter(p.repo)),
      on("nb-dual-off", (h) => h.setDual(false)),
      on("nb-mcp", (h, m) => h.mcpDo(m)),
    ];
    return () => un.forEach((p) => p.then((f) => f()));
  }, []);
  // closing the main window with terminals out on their own (or a project open) asks first
  const closeNow = useRef();
  closeNow.current = { dual, floats: terms.filter((t) => t.float).length, n: terms.length, project: inProject?.id };
  useEffect(() => {
    const un = getCurrentWindow().onCloseRequested(async (e) => {
      const { dual, floats, n, project } = closeNow.current;
      const why = [dual && n && `${n} terminal${n > 1 ? "s" : ""} on the other screen`, !dual && floats && `${floats} popped-out terminal${floats > 1 ? "s" : ""}`, project && `the project ${project} open`].filter(Boolean);
      // ponytail: preventDefault before the await, Tauri reads it only after the handler settles; the plugin dialog, since window.confirm is refused here
      if (!why.length) return;
      e.preventDefault();
      if (await ask(`You have ${why.join(" and ")}.\n\nClose Nimbus anyway? Running shells will end.`, { title: "Close Nimbus?", kind: "warning", okLabel: "Close", cancelLabel: "Keep open" })) getCurrentWindow().destroy();
    });
    return () => un.then((f) => f());
  }, []);

  // ---- palette ----
  const paletteItems = () => {
    const pq = q.trim().toLowerCase();
    const go = (f) => () => { setOv(null); f(); };
    const cmds = [
      { icon: "ph-terminal", label: "New terminal", hint: "⌃`", run: go(newTerm) },
      { icon: "ph-browsers", label: dual ? "Terminals back in this window" : "Terminals on their own screen", run: go(() => setDual(!dual)) },
      { icon: "ph-arrow-u-up-left", label: "Switch all repos to main…", run: go(() => { setPanelRaw("files"); setAllMain(true); }) },
      { icon: "ph-git-branch", label: "Switch branch…", hint: K + SH + "B", run: () => showOv("branch") },
      { icon: "ph-github-logo", label: "Add repo or folder…", hint: K + "O", run: openAdd },
      { icon: "ph-folder-simple-plus", label: "Start a project…", run: startProject },
      inProject && { icon: "ph-sign-out", label: `Exit project ${inProject.id}`, run: go(exitProject) },
      ...repos.filter((x) => x.project && x.id !== inProject?.id).map((x) => ({ icon: "ph-folder-simple-star", label: "Focus on project " + x.id, run: go(() => enterProject(x.id)) })),
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
      { icon: "ph-signpost", label: "Take the tour", run: go(startTour) },
      ...reg.commands.map((c) => ({ icon: c.icon || "ph-puzzle-piece", label: c.label, sub: c.plugin, hint: c.hint, run: go(() => Promise.resolve().then(c.run).catch((e) => say(`${c.plugin}: ${e}`, true))) })),
    ];
    const m = (x) => !pq || (x.label + " " + (x.sub || "")).toLowerCase().includes(pq);
    // only the matching files become entries: a big workfolder has tens of thousands, and this runs per keystroke
    const files = [];
    outer: for (const x of live) for (const p of paths[x.id] || []) {
      if (files.length >= (pq ? 10 : 3)) break outer;
      const f = { icon: "ph-file", label: p.slice(p.lastIndexOf("/") + 1), sub: x.id + "/" + p };
      if (m(f)) files.push({ ...f, run: go(() => openFile(x.id, p, "code")) });
    }
    return [...(pq ? files : []), ...cmds.filter((x) => x && m(x)), ...(pq ? [] : files)].slice(0, 10);
  };
  const pItems = ov === "palette" ? paletteItems() : [];
  const pSel = Math.min(pIdx, Math.max(0, pItems.length - 1));
  useEffect(() => { if (ov === "palette") live.forEach((x) => paths[x.id] || invoke("files", { id: x.id }).then((p) => setPaths((ps) => ({ ...ps, [x.id]: p })), () => {})); }, [ov]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- keyboard ----
  const onKey = useRef();
  onKey.current = (e) => {
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (e.key === "Escape") { if (asking) return setAsking(null); if (reviewAsk) return setReviewAsk(null); setCtx(null); setSettingsOpen(false); setWhatsNew(null); setSearchOpen(false); return setOv(null); }
    if (dual && e.ctrlKey && e.shiftKey && e.code === "KeyT") { e.preventDefault(); return newTerm(); } // another tile on the other screen
    if (e.ctrlKey && e.code === "Backquote") { e.preventDefault(); return e.shiftKey ? toggleFloats() : toggleTerm(); }
    if (e.target.closest?.(".xterm")) return; // everything else belongs to the shell
    if (!mod) return;
    const hit = { k: () => (ov === "palette" ? setOv(null) : showOv("palette")), 1: () => setPanel("files"), 2: () => setPanel("git"), 3: () => setPanel("prs"), 4: () => setPanel("issues"), "\\": () => setPanelRaw((p) => (p ? null : lastPanel.current)), e: () => { setPanel("files"); setExpanded((v) => !v); }, o: openAdd, ",": () => setSettingsOpen(true) }[k];
    // "/" is Shift+7 on some layouts, so shift is fine here; "?" covers Shift+/ on US ones
    if (k === "/" || k === "?") { e.preventDefault(); ov === "keys" ? setOv(null) : showOv("keys"); }
    else if (e.shiftKey && k === "f") { e.preventDefault(); searchBox.current?.select(); if (hits) setSearchOpen(true); }
    else if (e.shiftKey && k === "b") { e.preventDefault(); showOv("branch"); }
    else if (e.shiftKey && k === "r") { e.preventDefault(); runReview("changes"); }
    else if (hit && !e.shiftKey) { e.preventDefault(); hit(); }
  };
  useEffect(() => { const h = (e) => onKey.current(e); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, []);

  // ---- editor: diff stats and review flags for CodeView ----
  const hunks = useMemo(() => parseDiff(doc.diff), [doc.diff]);
  const flagKey = review?.status === "done" && open && review.repo === open.repo
    ? review.findings.filter((f) => f.path === open.path && !f.resolved).map((f) => f.line + ":" + f.severity).join(",") : "";
  const flags = useMemo(() => Object.fromEntries(flagKey.split(",").filter(Boolean).map((x) => { const [l, sv] = x.split(":"); return [l, SEV[sv].c]; })), [flagKey]);
  const v = fileChanged ? view : "code", hl = open?.line;
  useEffect(() => { if (hl && v === "code") document.querySelector(`#term-area .code .line[data-n="${hl}"]`)?.scrollIntoView({ block: "center" }); }, [doc, hl, v]);
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
  const rail = [
    { icon: "ph-files", key: "files", title: `Files  ${K}1`, badge: live.length },
    { icon: "ph-git-diff", key: "git", title: `Changes  ${K}2`, badge: r.changes.length },
    { icon: "ph-git-pull-request", key: "prs", title: `Pull requests  ${K}3`, badge: prRepos.reduce((n, x) => n + (prs[x.id] || []).filter((p) => p.state === "open" || p.state === "draft").length, 0) },
    { icon: "ph-circle-dashed", key: "issues", title: `Issues  ${K}4`, badge: prRepos.reduce((n, x) => n + (issues[x.id] || []).filter((i) => i.state === "open").length, 0) },
  ];
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
            <button key={it.key} data-tour={it.key} className="rail" title={it.title} onClick={() => setPanel(it.key)} style={{ color: panel === it.key ? "var(--fg)" : "var(--dim)" }}>
              <I n={it.icon} />
              {panel === it.key && <span style={{ position: "absolute", left: -6, top: 9, bottom: 9, width: 2, borderRadius: 2, background: "var(--acc)" }} />}
              {it.badge > 0 && <span style={{ position: "absolute", top: 5, right: 4, minWidth: 14, height: 14, padding: "0 3px", borderRadius: 7, background: "var(--badge)", color: "var(--acc-ink)", fontSize: 9, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{it.badge}</span>}
            </button>
          ))}
          <div className="spacer" />
          <button data-tour="settings" className="rail" title={`Settings  ${K},`} onClick={() => setSettingsOpen(true)} style={{ color: "var(--dim)", fontSize: 18 }}><I n="ph-gear-six" /></button>
          <button className="rail" title={`Add repository  ${K}O`} onClick={openAdd} style={{ color: "var(--dim)", fontSize: 18 }}><I n="ph-plus" /></button>
          <div title={user ? "GitHub · " + user : "Not signed in to GitHub"} style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--chip)", color: "var(--acc-fg)", fontSize: 10, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 6, boxShadow: "0 0 0 1px var(--badge)" }}>
            {user ? user.slice(0, 2).toUpperCase() : <I n="ph-user" />}
          </div>
        </div>

        {/* Workfolder */}
        {panel === "files" && <FilesPanel {...{ open, allMain, startProject, inProject, exitProject, showProject, amCount, amPull, amStash, cloning, collapsed, expanded, fileCtx, groupHead, lastSet, live, mainOf, openAdd, openCtx, openDirs, openFile, othersBadge, park, parkAll, parked, paths, r, repoCtx, repos, reserveCtx, reserveOpen, restoreSet, rgroups, root, setActive, setAllMain, setAmPull, setAmStash, setExpanded, setOpenDirs, setOpenPR, setReserveOpen, sideHandle, sizes, switchAllMain, terms: termsHere, used, enterProject, agent }} />}

        {/* Source control */}
        {panel === "git" && <GitPanel {...{ open, act, commit, commitLabel, commitMsg, cur, dirtyRepos, dropStash, fileCtx, initGit, live, openCtx, openFile, openMulti, ov, publish, pull, push, r, root, runReview, setActive, setCommitMsg, setOv, showOv, sideHandle, sizes, stage, stageAll, staged, stashCtx, unstaged }} />}

        {/* Issues */}
        {panel === "issues" && <IssuesPanel {...{ full, issueCompact, issueCtx, issueFilter, issueQ, issues, loadIssues, openAdd, openCtx, openIssue, prRepos, r, say, setIssueCompact, setIssueFilter, setIssueQ, showIssue, sideHandle, sizes }} />}

        {/* Pull requests */}
        {panel === "prs" && <PrsPanel {...{ canOpenPR, createPR, full, loadPRs, openAdd, openCtx, openPR, prCompact, prCtx, prFilter, prQ, prRepos, prs, r, setPrCompact, setPrFilter, setPrQ, showPR, sideHandle, sizes }} />}

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
              <div onContextMenu={(e) => openCtx(e, editorCtx())} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}><CodeView {...{ doc, hunks, v, diffStyle, flags, hl }} /></div>
            </>
          )}

          {hasRepos && !open && !pr && !iss && !showReport && r.project && <ProjectHome key={r.id} x={r} {...{ live, inProject, setActive, exitProject, say, mcp }}
            startClaude={() => claudeIn(r.id)} addRepos={() => addToProject(r)} enterProject={() => enterProject(r.id)} deleteProject={() => deleteProject(r)} />}

          {hasRepos && !open && !pr && !iss && !showReport && !r.project && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 12%" }}>
              <div className="keys">{keyRows}</div>
            </div>
          )}

          {hasRepos && pr && !showReport && <PRPage {...{ act, openFile, pr, prAct, r, requestReview, say, setOpenPR, stashAnd }} />}

          {hasRepos && iss && !showReport && <IssuePage {...{ iss, issueCtx, openIssue, say, setOpenIssue }} />}

          {!hasRepos && repos.length > 0 && <ReserveHome {...{ collapsed, groupHead, lastSet, openAdd, openCtx, park, reserveCtx, restoreSet, rgroups, root, used }} />}

          {repos.length === 0 && <Onboarding {...{ obSteps }} />}

          {!dual && <Terminals {...{ closeTerm, dock, dragPane, floatsHidden, inArea, mine, newTerm, openCtx, popOut, resetSize, setTick, sizer, sizes, snap, termArea, termEnter, termOpen, terms, here, toggleTerm }} toDual={() => setDual(true)} />}
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
      <StatusBar {...{ open, cur, dual, floatsHidden, focusTerms, hits, push, r, runUpdate, say, search, searchBox, searchOpen, searching, setSearchOpen, setSq, showOv, sq, terms: termsHere, toggleFloats, toggleTerm, update, user }} />

      {/* Search results: floats above the status bar and stays open while you open hits */}
      {searchOpen && hits && <SearchResults {...{ open, fileCtx, hits, live, openCtx, openFile, setSearchOpen }} />}

      {/* Branch switcher */}
      {ov === "branch" && r.id && <BranchSwitcher {...{ bq, branchRows, createBranch, q, r, setOv, setQ, switchBranch }} />}

      {/* Command palette */}
      {ov === "palette" && <Palette {...{ pItems, pSel, q, setOv, setPIdx, setQ }} />}

      {/* Add repository */}
      {ov === "add" && <AddRepo {...{ addLocal, addTab, aq, chooseFolder, cloneGh, cloneUrl, cloning, ghRepos, localDirs, park, q, repos, root, setOv, setQ, setUrlVal, showAddTab, urlParts, urlVal, user }} />}

      {ov === "keys" && <KeysDialog {...{ setOv }} />}

      {ov === "multi" && <MultiCommit {...{ dirtyRepos, mc, multiCommit, setMc, setOv }} />}

      {ov === "project" && proj && <NewProject key={proj.edit || ""} {...{ proj, repos, saveProject, setOv }} />}

      {asking && <AskName {...{ asking, setAsking }} />}
      {tour && !wizard && !whatsNew && !settingsOpen && <Tour close={endTour} />}
      {reviewAsk && <ReviewerPicker title={`Request review on #${reviewAsk.p.num}`} send={sendReview} close={() => setReviewAsk(null)}
        people={Array.isArray(people.current[reviewAsk.rp.id]) ? people.current[reviewAsk.rp.id].filter((x) => x !== reviewAsk.p.author && !reviewAsk.p.reviewers?.includes(x)) : null} />}

      {ctx && <ContextMenu {...{ ctx, setCtx }} />}

      {whatsNew && !wizard && <Changelog since={whatsNew.since} current={whatsNew.current} close={() => setWhatsNew(null)} />}
      {settingsOpen && <Settings close={() => { setSettingsOpen(false); setDiffStyle(settings.diffStyle); }} say={say} openWizard={() => setWizard(true)} reload={load} whatsNew={() => { setSettingsOpen(false); showWhatsNew(); }} tour={startTour}
        groups={groups} newGroup={() => newGroup()} renameGroup={renameGroup} deleteGroup={deleteGroup} changed={() => setTick((t) => t + 1)}
        update={update} runUpdate={() => { setSettingsOpen(false); runUpdate(); }}
        checkNow={(quiet) => { if (!quiet) say("Checking for updates…"); return checkUpdate(15000).then((u) => { if (u) setUpdate(u); if (!quiet) say(u ? `Nimbus ${u.version} is available` : "You're on the latest version"); }); }} />}
      {wizard && <Wizard done={finishWizard} addRepos={openAdd} />}
      {updating && <Splash label={`Updating to ${update.version}`} sub={updating.p >= 1 ? "Restarting…" : "Downloading…"} progress={updating.p} />}

      {toast && <Toast {...{ toast }} />}
    </div>
  );
}
