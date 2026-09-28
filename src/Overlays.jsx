// Dialogs and popovers drawn over the app. State lives in App; one overlay at a time (see `ov`).
import { useState } from "react";
import { I, Check, seg, K, keyRows } from "./ui.jsx";
import { ago, fuzzy, START, KICKOFF } from "./lib.js";
import projectArt from "./assets/project.webp";

/** Cross-repo search results: floats above the status bar and stays open while you open hits. */
export function SearchResults({ open, fileCtx, hits, live, openCtx, openFile, setSearchOpen }) {
  return (
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
  );
}

/** Switch to or create a branch in the active repo. */
export function BranchSwitcher({ bq, branchRows, createBranch, q, r, setOv, setQ, switchBranch }) {
  return (
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
  );
}

/** Command palette: files and commands. */
export function Palette({ pItems, pSel, q, setOv, setPIdx, setQ, placeholder = "Files, commands, branches…" }) {
  return (
    <>
      <div className="scrim" onClick={() => setOv(null)} style={{ zIndex: 25, background: "rgba(10,11,18,0.35)" }} />
      <div className="pop" style={{ position: "absolute", top: 56, left: "50%", transform: "translateX(-50%)", width: 560, maxWidth: "calc(100% - 32px)", zIndex: 26, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, height: 48, padding: "0 16px", borderBottom: "1px solid color-mix(in srgb, var(--fg) 7%, transparent)" }}>
          <I n="ph-magnifying-glass" style={{ color: "var(--dim)", fontSize: 15 }} />
          <input autoFocus className="field" value={q} onChange={(e) => { setQ(e.target.value); setPIdx(0); }} placeholder={placeholder} style={{ flex: 1, fontSize: 14.5 }}
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
  );
}

/** Add to workfolder: clone from GitHub or a URL, or link a local folder. */
export function AddRepo({ addLocal, addTab, aq, chooseFolder, cloneGh, cloneUrl, cloning, ghRepos, localDirs, park, q, repos, root, setOv, setQ, setUrlVal, showAddTab, urlParts, urlVal, user }) {
  return (
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
  );
}

/** Keyboard shortcuts. */
export function KeysDialog({ setOv }) {
  return (
    <>
      <div className="scrim" onClick={() => setOv(null)} style={{ zIndex: 25, background: "rgba(10,11,18,0.35)" }} />
      <div className="pop" style={{ position: "absolute", top: 56, left: "50%", transform: "translateX(-50%)", width: 400, maxWidth: "calc(100% - 32px)", zIndex: 26, borderRadius: 12, padding: "18px 22px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 500, marginBottom: 14 }}><I n="ph-keyboard" style={{ color: "var(--acc)" }} />Keyboard shortcuts</div>
        <div className="keys">{keyRows}</div>
      </div>
    </>
  );
}

/** One commit message into several repos, optionally on a shared branch with linked PRs. */
export function MultiCommit({ dirtyRepos, mc, multiCommit, setMc, setOv }) {
  return (
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
  );
}

/** "Start a project": a name, a goal, the repos it covers (reserve ones first) and where Claude reports back.
 * With `proj.edit` set it only adds repos to that project. */
export function NewProject({ proj, repos, saveProject, setOv }) {
  const edit = proj.edit, had = proj.init?.repos || [];
  const [name, setName] = useState(edit || "");
  const [goal, setGoal] = useState("");
  const [pick, setPick] = useState(had);
  const [kind, setKind] = useState("issue");
  const [ghRepo, setGhRepo] = useState("");
  const [issue, setIssue] = useState("");
  const [msg, setMsg] = useState(edit ? KICKOFF : START);
  const [busy, setBusy] = useState(false);
  const choices = repos.filter((x) => x.git && !x.project).sort((a, b) => b.parked - a.parked || a.id.localeCompare(b.id));
  const remotes = choices.filter((x) => x.remote && pick.includes(x.id)).map((x) => x.remote);
  const on = remotes.includes(ghRepo) ? ghRepo : remotes[0];
  const bad = !edit && (!/^[\w][\w .-]*$/.test(name.trim()) ? "Letters, numbers, spaces, - _ and ." : repos.some((x) => x.id === name.trim()) && `${name.trim()} is already in the workfolder`);
  const go = async (claude) => {
    setBusy(true);
    await saveProject({ name: name.trim(), goal, repos: choices.filter((x) => pick.includes(x.id)), report: kind === "issue" && on ? { kind, repo: on, issue: issue.replace(/\D/g, "") } : { kind: "html" } }, claude && msg);
    setBusy(false);
  };
  const field = { flex: "none", height: 32, padding: "0 10px", borderRadius: 8, border: 0, background: "color-mix(in srgb, var(--bg) 70%, transparent)", boxShadow: "0 0 0 1px var(--border)", outline: "none", color: "var(--fg)", fontSize: 12.5 };
  return (
    <>
      <div className="scrim" onClick={() => setOv(null)} style={{ zIndex: 30, background: "rgba(10,11,18,0.6)" }} />
      <div className="pop" style={{ position: "absolute", top: "6%", left: "50%", transform: "translateX(-50%)", width: 640, maxWidth: "calc(100% - 32px)", zIndex: 31, borderRadius: 14, padding: "18px 20px 20px", display: "flex", flexDirection: "column", gap: 12, maxHeight: "84%", overflow: "auto" }}>
        {/* banner fades into the dialog; the title sits on its lower edge */}
        <div style={{ margin: "-18px -20px -4px", aspectRatio: "16 / 5", flex: "none", borderRadius: "14px 14px 0 0", background: `linear-gradient(transparent 55%, var(--pop)), url(${projectArt}) center 45%/cover` }} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 500 }}>{edit ? `Add repos to ${edit}` : "Start a project"}</div>
          <div style={{ fontSize: 12, color: "var(--mid)", marginTop: 3 }}>{edit ? "They get linked into the project folder and listed in its CLAUDE.md." : "A folder in the workfolder with the repos linked inside and a CLAUDE.md telling Claude the goal and how to report back. Add more repos later from its right-click menu."}</div>
        </div>
        {!edit && <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" style={field} />}
        {!edit && name.trim() && bad && <div style={{ fontSize: 11.5, color: "var(--del)", marginTop: -6 }}>{bad}</div>}
        {!edit && <textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Goal: what done looks like (Claude asks if you leave it empty)" rows={3}
          style={{ ...field, height: "auto", resize: "none", padding: "8px 10px", lineHeight: "18px" }} />}
        <div className="label">Repos</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 94, overflow: "auto", marginTop: -4, flex: "none" }}>
          {!choices.length && <div style={{ color: "var(--dim)" }}>No repos in the workfolder yet.</div>}
          {choices.map((x) => {
            const in_ = pick.includes(x.id), fixed = had.includes(x.id);
            return (
              <div key={x.id} className="linkish" onClick={() => fixed || setPick((p) => (in_ ? p.filter((y) => y !== x.id) : [...p, x.id]))} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: in_ ? "var(--fg)" : "var(--dim)", minWidth: 0, opacity: fixed ? 0.6 : 1 }}>
                <Check on={in_} /><span className="ellip">{x.id}</span>
                <span className="spacer" />{x.parked && <span style={{ fontSize: 11, color: "var(--dimmer)", flex: "none" }}>reserve</span>}
              </div>
            );
          })}
        </div>
        {!edit && <>
          <div className="label">Claude reports back on</div>
          <div style={{ marginTop: -4 }}>{seg([["A GitHub issue", kind === "issue", () => setKind("issue")], ["An HTML page", kind === "html", () => setKind("html")]])}</div>
          {kind === "issue" && (remotes.length ? <>
            {remotes.length > 1 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{remotes.map((g) => <span key={g} className="linkish" onClick={() => setGhRepo(g)} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: g === on ? "var(--fg)" : "var(--dim)" }}><Check on={g === on} />{g}</span>)}</div>}
            <input className="mono" value={issue} onChange={(e) => setIssue(e.target.value)} placeholder={`Issue number in ${on}, or empty: Claude opens one`} style={field} />
            <div style={{ fontSize: 12, color: "var(--dim)", lineHeight: 1.5 }}>Claude keeps the issue's description current as the report: goal, status, outstanding, difficulties, done. It also comments on each update so you get notified.</div>
          </> : <div style={{ fontSize: 12, color: "var(--dim)" }}>Pick a repo that's on GitHub, or report to an HTML page.</div>)}
          {kind === "html" && <div style={{ fontSize: 12, color: "var(--dim)", lineHeight: 1.5 }}>Claude keeps <span className="mono">REPORT.html</span> in the project folder current: goal, status, outstanding, difficulties, done. Right-click the project to open it.</div>}
        </>}
        <div className="label">First message to Claude</div>
        <textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Empty: Claude just starts" rows={2}
          style={{ ...field, height: "auto", resize: "none", padding: "8px 10px", lineHeight: "18px", marginTop: -4 }} />
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn" disabled={busy || !!bad || !pick.length || (!edit && kind === "issue" && !on)} onClick={() => go(true)} style={{ flex: 1 }}><I n="ph-terminal" />{edit ? "Add and start Claude" : "Create and start Claude"}</button>
          <button className="ghost" disabled={busy || !!bad || !pick.length || (!edit && kind === "issue" && !on)} onClick={() => go(false)} style={{ height: 30 }}>{edit ? "Add" : "Create"}</button>
          <button className="ghost" onClick={() => setOv(null)} style={{ height: 30 }}>Cancel</button>
        </div>
      </div>
    </>
  );
}

/** The small naming dialog (groups, worktree branches). */
export function AskName({ asking, setAsking }) {
  return (
    <>
      <div className="scrim" onClick={() => setAsking(null)} style={{ zIndex: 70, background: "rgba(10,11,18,0.45)" }} />
      <form className="pop" onSubmit={(e) => { e.preventDefault(); asking.ok(e.target.elements.name.value); setAsking(null); }}
        style={{ position: "absolute", top: "22%", left: "50%", transform: "translateX(-50%)", width: 360, maxWidth: "calc(100% - 32px)", zIndex: 71, padding: 18 }}>
        <div style={{ fontWeight: 500, marginBottom: 12 }}>{asking.title}</div>
        <input name="name" autoFocus defaultValue={asking.value} placeholder={asking.placeholder || "Name"} onKeyDown={(e) => e.key === "Escape" && setAsking(null)}
          style={{ width: "100%", height: 34, padding: "0 10px", borderRadius: 8, border: 0, background: "color-mix(in srgb, var(--bg) 70%, transparent)", boxShadow: "0 0 0 1px var(--border)", outline: "none", color: "var(--fg)", fontSize: 13 }} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 14 }}>
          <button type="button" className="ghost" onClick={() => setAsking(null)} style={{ height: 30 }}>Cancel</button>
          <button type="submit" className="btn">{asking.okLabel || "Save"}</button>
        </div>
      </form>
    </>
  );
}

/** Pick PR reviewers: fuzzy-filtered `people` (null while loading); Enter adds the highlighted one, or what's typed. */
export function ReviewerPicker({ title, people, send, close }) {
  const [picked, setPicked] = useState([]);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const hits = (people || []).filter((x) => !picked.includes(x) && fuzzy(q, x)).slice(0, 8);
  const add = (x) => { if (x && !picked.includes(x)) setPicked([...picked, x]); setQ(""); setHi(0); };
  const key = (e) => {
    if (e.key === "Escape") return close();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); return setHi((h) => (h + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % Math.max(hits.length, 1)); }
    if (e.key === "Backspace" && !q) return setPicked(picked.slice(0, -1));
    if (e.key === "Enter") { e.preventDefault(); if (q.trim()) add(hits[hi] || q.trim()); else send(picked); }
  };
  return (
    <>
      <div className="scrim" onClick={close} style={{ zIndex: 70, background: "rgba(10,11,18,0.45)" }} />
      <div className="pop" style={{ position: "absolute", top: "22%", left: "50%", transform: "translateX(-50%)", width: 380, maxWidth: "calc(100% - 32px)", zIndex: 71, padding: 18 }}>
        <div style={{ fontWeight: 500, marginBottom: 12 }}>{title}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", minHeight: 34, padding: "4px 8px", borderRadius: 8, background: "color-mix(in srgb, var(--bg) 70%, transparent)", boxShadow: "0 0 0 1px var(--border)" }}>
          {picked.map((x) => (
            <span key={x} className="hov" title="Remove" onClick={() => setPicked(picked.filter((y) => y !== x))}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 6, fontSize: 12, background: "color-mix(in srgb, var(--fg) 8%, transparent)" }}>{x}<I n="ph-x" style={{ fontSize: 10 }} /></span>
          ))}
          <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} onKeyDown={key} placeholder={picked.length ? "" : "Search people"}
            style={{ flex: 1, minWidth: 80, height: 24, border: 0, background: "transparent", outline: "none", color: "var(--fg)", fontSize: 13 }} />
        </div>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", minHeight: 30 }}>
          {people === null ? <span style={{ color: "var(--dim)", fontSize: 12, padding: "6px 8px" }}>Loading collaborators…</span>
            : hits.map((x, i) => (
              <div key={x} className="hov" onClick={() => add(x)} onMouseEnter={() => setHi(i)}
                style={{ display: "flex", alignItems: "center", gap: 8, height: 28, padding: "0 8px", borderRadius: 6, fontSize: 13, background: i === hi ? "color-mix(in srgb, var(--fg) 6%, transparent)" : undefined }}>
                <I n="ph-user" style={{ color: "var(--dimmer)" }} />{x}
              </div>
            ))}
          {people && !hits.length && <span style={{ color: "var(--dim)", fontSize: 12, padding: "6px 8px" }}>{q ? "Enter adds it as typed" : people.length ? "Everyone's picked" : "No collaborators found, type a username"}</span>}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 14 }}>
          <button className="ghost" onClick={close} style={{ height: 30 }}>Cancel</button>
          <button className="btn" disabled={!picked.length} onClick={() => send(picked)}>Request</button>
        </div>
      </div>
    </>
  );
}

/** Right-click menu. */
export function ContextMenu({ ctx, setCtx }) {
  return (
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
  );
}

/** Short message in the corner. */
export function Toast({ toast }) {
  return (
    <div style={{ position: "absolute", right: 16, bottom: 40, zIndex: 40, maxWidth: "min(560px, calc(100% - 32px))", display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderRadius: 8, background: "var(--pop)", boxShadow: "0 0 0 1px var(--dimmer),0 6px 18px rgba(0,0,0,0.55)", fontSize: 12.5, animation: "rise .16s ease-out" }}>
      <span style={{ width: 6, height: 6, flex: "none", borderRadius: "50%", background: toast.err ? "var(--del)" : "var(--acc)", boxShadow: `0 0 8px ${toast.err ? "var(--del)" : "var(--acc)"}` }} />
      <span className="ellip">{toast.t}</span>
    </div>
  );
}
