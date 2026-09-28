// The sidebar tabs and the status bar. State lives in App; these only draw it and call back.
import { I, Check, seg, bInfo, ST, PRC, CHK, LANG, K, SH, git, gh } from "./ui.jsx";
import { ago, buildTree, fuzzy } from "./lib.js";
import { store } from "./settings.js";
import { reg } from "./plugins.js";

/** Files tab: the workfolder's repos with their file trees, then the reserve. */
export function FilesPanel({ open, allMain, amCount, amPull, amStash, cloning, collapsed, expanded, fileCtx, groupHead, lastSet, live, mainOf, openAdd, openCtx, openDirs, openFile, othersBadge, park, parkAll, parked, paths, r, repoCtx, repos, reserveCtx, reserveOpen, restoreSet, rgroups, root, setActive, setAllMain, setAmPull, setAmStash, setExpanded, setOpenDirs, setOpenPR, setReserveOpen, sideHandle, sizes, switchAllMain, terms, used }) {
  return (
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
  );
}

/** Changes tab: commit box, staged and unstaged files, history and stashes of the active repo. */
export function GitPanel({ open, act, commit, commitLabel, commitMsg, cur, dirtyRepos, dropStash, fileCtx, initGit, live, openCtx, openFile, openMulti, ov, publish, pull, push, r, root, runReview, setActive, setCommitMsg, setOv, showOv, sideHandle, sizes, stage, stageAll, staged, stashCtx, unstaged }) {
  return (
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
  );
}

/** Issues tab: open/closed issues of every GitHub repo in the workfolder. */
export function IssuesPanel({ full, issueCompact, issueCtx, issueFilter, issueQ, issues, loadIssues, openAdd, openCtx, openIssue, prRepos, r, say, setIssueCompact, setIssueFilter, setIssueQ, showIssue, sideHandle, sizes }) {
  return (
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
          const many = all.length > 1, list = full.current.issues.has(rp.id) && issues[rp.id]?.filter((i) => (issueFilter === "all" || i.state === issueFilter) && fuzzy(issueQ, `#${i.num} ${i.title} ${i.author} ${i.labels.map((l) => l.name).join(" ")} ${i.assignees.join(" ")}`));
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
  );
}

/** Pull requests tab, grouped by repo like Issues. */
export function PrsPanel({ canOpenPR, createPR, full, loadPRs, openAdd, openCtx, openPR, prCompact, prCtx, prFilter, prQ, prRepos, prs, r, setPrCompact, setPrFilter, setPrQ, showPR, sideHandle, sizes }) {
  return (
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
          const list = full.current.prs.has(rp.id) && prs[rp.id]?.filter((p) => (prFilter === "all" || p.state === prFilter || (prFilter === "open" && p.state === "draft")) && fuzzy(prQ, `#${p.num} ${p.title} ${p.head} ${p.author}`));
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
  );
}

/** The bar along the bottom: repo, branch, sync, plugin items, search box, terminal toggle. */
export function StatusBar({ open, cur, dual, floatsHidden, focusTerms, hits, push, r, runUpdate, say, search, searchBox, searchOpen, searching, setSearchOpen, setSq, showOv, sq, terms, toggleFloats, toggleTerm, update, user }) {
  return (
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
      {dual
        ? <span className="linkish" onClick={focusTerms} title="Bring the terminals window forward" style={{ display: "flex", alignItems: "center", gap: 5 }}><I n="ph-browsers" style={{ fontSize: 12 }} />{terms.length} on the other screen</span>
        : <span className="linkish" onClick={toggleTerm} style={{ display: "flex", alignItems: "center", gap: 5 }}><I n="ph-terminal-window" style={{ fontSize: 12 }} />Terminal</span>}
      {!dual && floatsHidden && <span className="linkish" onClick={toggleFloats} title="Show popped-out terminals (⌃⇧`)" style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--acc-soft)" }}><I n="ph-eye" style={{ fontSize: 12 }} />{terms.filter((t) => t.float).length} hidden</span>}
      <span>{open ? LANG[open.path.split(".").pop()] || "Plain text" : "—"}</span>
      {user && <span style={{ display: "flex", alignItems: "center", gap: 6 }}><I n="ph-github-logo" style={{ fontSize: 12 }} />{user}</span>}
    </div>
  );
}
