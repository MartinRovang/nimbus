// What fills the editor area: the open file, a PR, an issue, or the empty-workfolder screens.
import { memo, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { I, bInfo, Toks, ST, PRC, CHK, gh, git, mainOf, ADD_BG, DEL_BG, EMPTY_BG } from "./ui.jsx";
import { ago, splitRows, parseDiff, splitDiff, mapLineComment, PHASES, withBridge } from "./lib.js";

/** The open file as code, or its diff unified or split. Memoized: re-tokenizing a big file on every keystroke is noticeable. */
export const CodeView = memo(function CodeView({ diffStyle, doc, flags, hl, hunks, v }) {
  const flag = (n) => (flags[n] ? `inset 2px 0 0 ${flags[n]}` : undefined);
  if (v === "code") {
    if (doc.err) return <div style={{ padding: "24px 20px", color: "var(--dim)" }}>{doc.err}</div>;
    // Lines go in blocks of 400 that the webview skips laying out and painting while off screen (content-visibility).
    // ponytail: every line is still a DOM node; real virtualization if 100k+ line files matter. Past 20k lines
    // highlighting is skipped, it costs a span per token.
    const lines = doc.text.split("\n"), plain = lines.length > 20000, B = 400;
    return (
      <div className="code" style={{ padding: "14px 0 40px" }}>
        {Array.from({ length: Math.ceil(lines.length / B) }, (_, b) => (
          <div key={b} style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${Math.min(B, lines.length - b * B) * 1.62}em` }}>
            {lines.slice(b * B, b * B + B).map((l, j) => {
              const n = b * B + j + 1;
              return <div className="line" key={n} data-n={n} style={{ boxShadow: flag(n), background: n === hl ? "color-mix(in srgb, var(--acc) 14%, transparent)" : undefined }}><span className="ln" style={{ width: 60, paddingRight: 24 }}>{n}</span><span className="pre">{plain ? l : <Toks code={l} />}</span></div>;
            })}
          </div>
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
});

/** One pull request in the editor area. */
export function PRPage({ act, openFile, pr, prAct, r, requestReview, say, setOpenPR, stashAnd }) {
  // the PR's own diff and its line comments, fetched when the page opens (App keys the page by PR)
  const [diffs, setDiffs] = useState(null), [lineNotes, setLineNotes] = useState([]), [shown, setShown] = useState(null), [tab, setTab] = useState("Overview");
  useEffect(() => {
    gh(r.id, "pr", "diff", String(pr.num)).then((t) => setDiffs(splitDiff(t)), (e) => { setDiffs({}); say(e, true); });
    // ponytail: first 100 line comments, no resolved/outdated state; GraphQL reviewThreads if that matters
    gh(r.id, "api", `repos/{owner}/{repo}/pulls/${pr.num}/comments?per_page=100`).then((t) => setLineNotes(JSON.parse(t).map(mapLineComment)), (e) => say(e, true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const thread = [...pr.thread, ...lineNotes].sort((a, b) => (a.at < b.at ? -1 : 1));
  const VC = { approved: "var(--add)", "changes requested": "var(--del)" };
  return (
    <>
      <div className="head" style={{ gap: 8, padding: "0 12px 0 20px", borderBottom: "1px solid color-mix(in srgb, var(--fg) 5%, transparent)" }}>
        <span style={{ color: "var(--dim)" }}>{r.id}</span><span style={{ color: "var(--border)" }}>/</span><span>Pull request #{pr.num}</span>
        <div className="spacer" />
        <button className="ib" title="Close" onClick={() => setOpenPR(null)} style={{ color: "var(--dim)" }}><I n="ph-x" /></button>
      </div>
      <div style={{ display: "flex", gap: 4, padding: "10px 30px 0" }}>
        {[["Overview"], ["Files", pr.files.length], ["Comments", thread.length]].map(([t, n]) => (
          <span key={t} className="linkish" onClick={() => setTab(t)}
            style={{ padding: "3px 10px", borderRadius: 999, fontSize: 12.5, color: tab === t ? "var(--fg)" : "var(--dim)", fontWeight: tab === t ? 500 : 400,
              background: tab === t ? "color-mix(in srgb, var(--acc) 18%, transparent)" : "transparent" }}>{t}{n != null && <span style={{ color: "var(--dimmer)" }}> {n}</span>}</span>
        ))}
      </div>
      <div style={{ flex: 1, overflow: "auto", minHeight: 0, padding: "20px 40px 48px" }}>
        <div style={{ maxWidth: 720 }}>
          {tab === "Overview" && <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--dim)", flexWrap: "wrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5, color: PRC[pr.state] }}><I n="ph-git-pull-request" />{pr.state[0].toUpperCase() + pr.state.slice(1)}</span>
            <span>#{pr.num}</span><span>·</span><span>{pr.author}</span><span>·</span><span>{pr.when}</span><span>·</span><span>{pr.review}</span>{pr.reviewers?.length > 0 && <><span>·</span><span>waiting on {pr.reviewers.join(", ")}</span></>}
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
          {pr.verdicts.length > 0 && <>
            <div className="label" style={{ marginTop: 28 }}>Reviews</div>
            <div style={{ marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5 }}>
              {pr.verdicts.map((x) => <span key={x.who}>{x.who} <span style={{ color: VC[x.verdict] || "var(--dim)" }}>{x.verdict}</span></span>)}
            </div>
          </>}
          <div style={{ marginTop: 28, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {pr.state === "open" && <button className="btn" style={{ height: 32, padding: "0 16px", fontSize: 13, fontWeight: 500 }} onClick={() => prAct(() => gh(r.id, "pr", "merge", String(pr.num), "--squash"), `Merged #${pr.num} into ${pr.base}`)}><I n="ph-git-merge" />Squash and merge</button>}
            {pr.state === "merged" && <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--acc-soft)", fontSize: 13, paddingRight: 8 }}><I n="ph-git-merge" />Merged into {pr.base}</span>}
            {pr.state === "open" && <button className="ghost" onClick={() => requestReview(pr)}><I n="ph-user-plus" />Request review</button>}
            <button className="ghost" onClick={() => act(r.id, () => stashAnd(r.id, pr.head, () => gh(r.id, "pr", "checkout", String(pr.num))), "Switched to " + pr.head)}>Check out branch</button>
            <button className="ghost" onClick={() => gh(r.id, "pr", "view", String(pr.num), "--web").catch((e) => say(e, true))}><I n="ph-arrow-square-out" />GitHub</button>
          </div>
          </>}
          {tab === "Comments" && (thread.length === 0 ? <div style={{ color: "var(--dim)" }}>No comments yet.</div> : thread.map((c, n) => (
            <div key={n} style={{ marginTop: n && 12, paddingLeft: 12, boxShadow: `inset 2px 0 0 ${VC[c.verdict] || "var(--border)"}` }}>
              <div style={{ fontSize: 12, color: "var(--dim)" }}>{c.author}{c.verdict && <> · <span style={{ color: VC[c.verdict] }}>{c.verdict}</span></>} · {ago(c.at)}{c.path && <> · <span className="linkish mono" onClick={() => { setShown(c.path); setTab("Files"); }}>{c.path}{c.line ? ":" + c.line : ""}</span></>}</div>
              {c.body && <div style={{ marginTop: 4, color: "var(--soft)", lineHeight: 1.6, maxWidth: "62ch", whiteSpace: "pre-wrap" }}>{c.body}</div>}
            </div>
          )))}
          {tab === "Files" && <div style={{ display: "flex", flexDirection: "column", marginLeft: -10 }}>
            {pr.files.map((f) => {
              const parts = f.path.split("/"), name = parts.pop();
              const hunks = shown === f.path && diffs ? parseDiff(diffs[f.path] || "") : null;
              return (
                <div key={f.path}>
                  <div className="hov" onClick={() => setShown(shown === f.path ? null : f.path)} style={{ display: "flex", alignItems: "center", gap: 10, height: 30, padding: "0 10px", borderRadius: 6 }}>
                    <I n={shown === f.path ? "ph-caret-down" : "ph-caret-right"} style={{ color: "var(--dimmer)" }} /><span>{name}</span>
                    <span className="ellip" style={{ flex: 1, minWidth: 0, color: "var(--dimmer)", fontSize: 12 }}>{parts.join("/")}</span>
                    <span className="mono" style={{ fontSize: 11, color: ST.A }}>+{f.adds}</span><span className="mono" style={{ fontSize: 11, color: ST.D }}>−{f.dels}</span>
                    <button className="ib" title="Open the file in the working tree" onClick={(e) => { e.stopPropagation(); openFile(r.id, f.path, r.changes.some((c) => c.path === f.path) ? "diff" : "code"); }}><I n="ph-file" /></button>
                  </div>
                  {shown === f.path && (!diffs ? <div style={{ padding: "6px 10px", color: "var(--dim)" }}><I n="ph-circle-notch spin" /> Loading diff…</div>
                    : !hunks.length ? <div style={{ padding: "6px 10px", color: "var(--dim)" }}>No text diff (binary, renamed or too large).</div>
                    : <div style={{ margin: "2px 0 10px 10px", overflowX: "auto", borderRadius: 6, boxShadow: "0 0 0 1px var(--border)" }}>
                      <CodeView v="diff" diffStyle="unified" doc={{}} hunks={hunks} flags={Object.fromEntries(lineNotes.filter((c) => c.path === f.path && c.line).map((c) => [c.line, "var(--mod)"]))} />
                    </div>)}
                </div>
              );
            })}
          </div>}
        </div>
      </div>
    </>
  );
}

/** One issue in the editor area. */
export function IssuePage({ iss, issueCtx, openIssue, say, setOpenIssue }) {
  return (
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
  );
}

const DIFF = ":diff"; // the Diff tab, next to the report and the pages (never a file name: those end in .html)

/** A project's changes per repo against main: everything on the branch, committed or not, the way its PR will look. Click a file for its diff. */
export function ProjectDiff({ repos, n, height = 560 }) {
  const [files, setFiles] = useState({}), [sel, setSel] = useState(null), [d, setD] = useState(null);
  // the base is where the branch left main (origin's if fetched); diffing the working tree against it includes uncommitted work
  const base = (x) => git(x.id, "merge-base", "HEAD", "origin/" + mainOf(x)).catch(() => git(x.id, "merge-base", "HEAD", mainOf(x))).then((s) => s.trim());
  useEffect(() => {
    let dead = false;
    Promise.all(repos.filter((x) => x.git).map(async (x) => {
      try {
        const b = await base(x), out = await git(x.id, "diff", "--name-status", "--no-renames", b);
        const got = out.split("\n").filter(Boolean).map((l) => { const [st, path] = l.split("\t"); return { st: st[0], path }; });
        const untracked = x.changes.filter((c) => c.status === "A" && !got.some((g) => g.path === c.path)) // untracked shows as A in changes, and git diff skips it.map((c) => ({ st: "A", path: c.path, untracked: true }));
        return [x.id, { base: b, list: [...got, ...untracked] }];
      } catch (e) { return [x.id, { err: String(e), list: [] }]; }
    })).then((rs) => !dead && setFiles(Object.fromEntries(rs)));
    return () => { dead = true; };
  }, [repos.map((x) => x.id + x.branch + x.changes.length).join(), n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sel) return;
    let dead = false;
    const f = files[sel.repo], one = f?.list.find((g) => g.path === sel.path);
    if (!one) return;
    (one.untracked ? invoke("diff", { id: sel.repo, path: sel.path }) : git(sel.repo, "diff", f.base, "--", sel.path))
      .then((text) => ({ k: sel.repo + ":" + sel.path, hunks: parseDiff(text) }), (e) => ({ k: sel.repo + ":" + sel.path, err: String(e) }))
      .then((r) => !dead && setD(r));
    return () => { dead = true; };
  }, [sel, files]);
  const k = sel && sel.repo + ":" + sel.path, total = Object.values(files).reduce((t, f) => t + f.list.length, 0);
  if (!repos.length) return <div style={{ color: "var(--dim)" }}>None of this project's repos are out of reserve.</div>;
  return (
    <div style={{ display: "flex", height, borderRadius: 10, overflow: "hidden", boxShadow: "0 0 0 1px var(--border)" }}>
      <div style={{ width: 240, flex: "none", overflow: "auto", padding: "6px 0", borderRight: "1px solid var(--border)" }}>
        {repos.map((x) => {
          const f = files[x.id];
          return (
            <div key={x.id} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 12px", fontSize: 12 }}>
                <span style={{ fontWeight: 500 }}>{x.id}</span>
                <span className="mono ellip" style={{ fontSize: 10.5, color: "var(--acc-soft)", minWidth: 0 }}>{x.branch}</span>
                <span className="spacer" /><span style={{ fontSize: 11, color: "var(--dimmer)" }}>{f?.list.length ?? ""}</span>
              </div>
              {!x.git ? <div style={{ padding: "2px 12px 2px 22px", fontSize: 11.5, color: "var(--dimmer)" }}>not a git repo</div>
                : f?.err ? <div style={{ padding: "2px 12px 2px 22px", fontSize: 11.5, color: "var(--dimmer)" }} title={f.err}>no {mainOf(x)} to compare with</div>
                : f && !f.list.length ? <div style={{ padding: "2px 12px 2px 22px", fontSize: 11.5, color: "var(--dimmer)" }}>same as {mainOf(x)}</div>
                : f?.list.map((g) => (
                  <div key={g.path} className="hov" title={g.path} onClick={() => setSel({ repo: x.id, path: g.path })}
                    style={{ display: "flex", alignItems: "center", gap: 7, height: 24, padding: "0 12px 0 22px", fontSize: 12, background: k === x.id + ":" + g.path ? "color-mix(in srgb, var(--acc) 12%, transparent)" : undefined }}>
                    <span className="ellip" style={{ flex: 1, minWidth: 0, direction: "rtl", textAlign: "left" }}>{g.path}</span>
                    <span className="mono" style={{ fontSize: 11, color: ST[g.st] || "var(--mod)" }}>{g.st}</span>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
      <div style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
        {!sel ? <div style={{ padding: 20, color: "var(--dim)" }}>{total ? "Pick a file to see its diff against main." : "Nothing changed against main yet."}</div>
          : d?.k !== k ? <div style={{ padding: 20, color: "var(--dim)" }}><I n="ph-circle-notch spin" /></div>
          : d.err ? <div style={{ padding: 20, color: "var(--dim)" }}>{d.err}</div>
          : <CodeView v="diff" diffStyle="unified" hunks={d.hunks} flags={{}} />}
      </div>
    </div>
  );
}

/** Opens one of a project's tabs (report, a page, the diff) in a window of its own, e.g. for the other screen; again: to the front. */
export const popOut = async (id, tab) => {
  const label = ("proj-" + id + "-" + (tab ?? "report")).replace(/[^a-zA-Z0-9_-]/g, "_"), w = await WebviewWindow.getByLabel(label);
  if (w) return w.setFocus();
  const name = tab === DIFF ? "Diff" : tab ? tab.replace(/\.html?$/i, "") : "Report";
  new WebviewWindow(label, { url: `index.html?view=project&project=${encodeURIComponent(id)}` + (tab ? "&tab=" + encodeURIComponent(tab) : ""), title: `Nimbus — ${id} · ${name}`, width: 1200, height: 800, minWidth: 600, minHeight: 360 });
};

/** What a project tab shows: the report (issue body or REPORT.html), a page, or the diff. On the project page and popped out. */
export function ProjectTab({ id, cfg, tab, n, repos, say, height = 560 }) {
  const [rep, setRep] = useState(null), [page, setPage] = useState(null);
  const rp = cfg.report || {}, rkey = JSON.stringify(rp);
  useEffect(() => {
    if (tab) return;
    let dead = false;
    (rp.kind === "issue"
      ? rp.issue ? gh(null, "issue", "view", String(rp.issue), "--repo", rp.repo, "--json", "body,url,updatedAt").then(JSON.parse).then((i) => ({ text: i.body, url: i.url, when: i.updatedAt }), (e) => ({ err: String(e) }))
        : Promise.resolve({ err: "No issue yet: Claude opens one when it starts work." })
      : invoke("read_file", { id, path: "REPORT.html" }).then((html) => ({ html }), () => ({ err: "No REPORT.html yet: Claude writes it after its first piece of work." })))
      .then((got) => !dead && setRep(got));
    return () => { dead = true; };
  }, [id, tab, rkey, n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!tab || tab === DIFF) return;
    let dead = false;
    invoke("read_file", { id, path: tab }).then((html) => ({ f: tab, html }), (e) => ({ f: tab, err: String(e) })).then((p) => !dead && setPage(p));
    return () => { dead = true; };
  }, [id, tab, n]);
  const shown = tab ? page?.f === tab && page : rep;
  // interactive pages: <page>.json goes into the frame (nimbus.onData) and what it saves (nimbus.save) comes back into that file
  const file = tab === DIFF ? null : tab || (rep?.html != null ? "REPORT.html" : null), json = file?.replace(/\.html?$/i, ".json");
  const frame = useRef(null), sent = useRef(), [data, setData] = useState(null); // data: { f, text } of the file on disk
  useEffect(() => {
    if (!file) return;
    let dead = false;
    invoke("read_file", { id, path: json }).catch(() => null).then((text) => !dead && setData((d) => (d?.f === file && d.text === text ? d : { f: file, text })));
    return () => { dead = true; };
  }, [id, file, json, n]);
  const post = () => {
    if (data?.f !== file) return;
    let v = null;
    try { v = data.text == null ? null : JSON.parse(data.text); } catch { return; } // Claude mid-edit: wait for the next read
    frame.current?.contentWindow?.postMessage({ nimbusData: v }, "*");
    sent.current = data;
  };
  useEffect(() => { if (data !== sent.current) post(); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = (e) => {
      if (!file || e.source !== frame.current?.contentWindow || e.data?.nimbus !== "save") return;
      const text = JSON.stringify(e.data.data ?? null, null, 2) + "\n";
      invoke("save_page_data", { id, page: file, json: text }).then(() => { const d = { f: file, text }; sent.current = d; setData(d); }, (err) => say(err, true));
    };
    addEventListener("message", on);
    return () => removeEventListener("message", on);
  }, [id, file, say]);
  if (tab === DIFF) return <ProjectDiff repos={repos} n={n} height={height} />;
  if (!shown) return <div style={{ color: "var(--dim)", display: "flex", gap: 8, alignItems: "center" }}><I n="ph-circle-notch spin" />Loading…</div>;
  if (shown.err) return <div style={{ color: "var(--dim)" }}>{shown.err}</div>;
  // scripts run (a UML diagram draws itself) but without allow-same-origin the page gets an opaque origin: no reach into Nimbus
  if (shown.html != null) return <iframe ref={frame} onLoad={post} key={tab ?? ""} title={tab ?? "Report"} sandbox="allow-scripts" srcDoc={withBridge(shown.html)} style={{ width: "100%", height, border: 0, borderRadius: 10, background: "#fff", boxShadow: "0 0 0 1px var(--border)" }} />;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--dimmer)", marginBottom: 8 }}>
        {shown.when && <span>updated {ago(shown.when)}</span>}
        {shown.url && <span className="linkish" onClick={() => invoke("open_url", { url: shown.url }).catch((e) => say(e, true))} style={{ display: "flex", alignItems: "center", gap: 4 }}><I n="ph-arrow-square-out" />Open on GitHub</span>}
      </div>
      <div style={{ color: "var(--soft)", lineHeight: 1.65, maxWidth: "80ch", whiteSpace: "pre-wrap" }}>{shown.text || "The issue is empty so far."}</div>
    </div>
  );
}

/** A project's page: its goal, repos and Claude's live report (the issue body, or REPORT.html), plus a tab per other .html page in the folder. Refreshes itself while open. */
export function ProjectHome({ x, live, inProject, setActive, startClaude, addRepos, enterProject, exitProject, deleteProject, say, mcp }) {
  const [cfg, setCfg] = useState(null), [n, setN] = useState(0);
  const [pages, setPages] = useState([]), [tab, setTab] = useState(null); // other .html Claude made here (UML.html, …); tab null = the report
  useEffect(() => {
    let dead = false;
    (async () => {
      const c = await invoke("read_file", { id: x.id, path: ".nimbus-project.json" }).then(JSON.parse).catch(() => ({}));
      if (!dead) setCfg((o) => (JSON.stringify(o) === JSON.stringify(c) ? o : c));
      const fs = await invoke("files", { id: x.id }).catch(() => []);
      if (!dead) setPages(fs.filter((f) => !f.includes("/") && /\.html?$/i.test(f) && f !== "REPORT.html"));
    })();
    return () => { dead = true; };
  }, [x.id, n]);
  // ponytail: polls every 10s (a gh call for issue reports); an unchanged page keeps its srcDoc so the frame doesn't reload. File watcher if this ever lags
  useEffect(() => { const t = setInterval(() => setN((k) => k + 1), 10000); return () => clearInterval(t); }, []);
  // Claude through `nimbus mcp`: refresh after it wrote something, show to open a tab (no page, or REPORT.html: the report)
  useEffect(() => {
    if (mcp?.project !== x.id) return;
    if (mcp.do === "show") setTab(!mcp.page || mcp.page === "REPORT.html" ? null : mcp.page);
    setN((k) => k + 1);
  }, [mcp, x.id]);
  const mine = live.filter((y) => cfg?.repos?.includes(y.id)), here = inProject?.id === x.id, rp = cfg?.report || {};
  const where = rp.kind === "issue" ? `${rp.repo}${rp.issue ? "#" + rp.issue : ""}` : "REPORT.html";
  const at = PHASES.findIndex((p) => p.id === cfg?.phase);
  // Claude moves the phase on in .nimbus-project.json; clicking one here moves it by hand (e.g. back to Development after review)
  const setPhase = async (id) => {
    const c = { ...cfg, phase: id };
    try { await invoke("save_project", { name: x.id, repos: c.repos || [], files: { ".nimbus-project.json": JSON.stringify(c, null, 2) + "\n" } }); setCfg(c); }
    catch (e) { say(e, true); }
  };
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "36px 8% 40px" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div className="label" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--acc-soft)" }}><I n="ph-folder-simple-star" />Project</div>
        <div style={{ marginTop: 6, fontSize: 24, fontWeight: 500 }}>{x.id}</div>
        <div style={{ marginTop: 8, color: cfg?.goal ? "var(--soft)" : "var(--dim)", lineHeight: 1.6, maxWidth: "70ch", whiteSpace: "pre-wrap" }}>{cfg ? cfg.goal || "No goal written yet: Claude asks for it." : "…"}</div>
        {cfg && <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", fontSize: 12.5 }}>
          {PHASES.map((p, i) => (
            <span key={p.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {i > 0 && <I n="ph-caret-right" style={{ fontSize: 10, color: "var(--dimmer)" }} />}
              <span className="linkish" title={`${p.does}\nDone when ${p.exit}.`} onClick={() => i !== at && setPhase(p.id)}
                style={{ padding: "3px 9px", borderRadius: 999, display: "flex", alignItems: "center", gap: 5, color: i === at ? "var(--fg)" : i < at ? "var(--soft)" : "var(--dim)", fontWeight: i === at ? 500 : 400,
                  background: i === at ? "color-mix(in srgb, var(--acc) 18%, transparent)" : "transparent", boxShadow: i === at ? "0 0 0 1px color-mix(in srgb, var(--acc) 40%, transparent)" : "none" }}>
                {i < at && <I n="ph-check" style={{ fontSize: 11, color: "var(--acc-soft)" }} />}{p.label}
              </span>
            </span>
          ))}
        </div>}
        <div style={{ marginTop: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={startClaude} style={{ height: 32, padding: "0 14px", fontSize: 13 }}><I n="ph-sparkle" />Start Claude</button>
          {here ? <button className="ghost" onClick={exitProject}><I n="ph-sign-out" />Exit project</button>
            : <button className="ghost" onClick={enterProject}><I n="ph-sign-in" />Focus on this project</button>}
          <button className="ghost" onClick={addRepos}><I n="ph-plus" />Add repos</button>
          <button className="ghost" onClick={deleteProject} style={{ color: "var(--del)" }}><I n="ph-trash" />Delete project</button>
        </div>

        <div className="label" style={{ marginTop: 32 }}>Repos</div>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", marginLeft: -10 }}>
          {cfg?.repos?.map((id) => {
            const y = mine.find((z) => z.id === id);
            if (!y) return <div key={id} style={{ height: 34, display: "flex", alignItems: "center", padding: "0 10px", color: "var(--dim)" }}>{id}<span className="spacer" /><span style={{ fontSize: 11.5 }}>in reserve</span></div>;
            const bi = bInfo(y);
            return (
              <div key={id} className="hov" onClick={() => setActive(id)} style={{ display: "flex", alignItems: "center", gap: 10, height: 34, padding: "0 10px", borderRadius: 8 }}>
                <span style={{ flex: "none" }}>{id}</span>
                <span className="mono" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--acc-soft)", minWidth: 0, overflow: "hidden" }}><I n={bi.chipIcon} style={{ flex: "none" }} /><span className="ellip">{bi.branchText}</span></span>
                <span className="spacer" />
                {y.changes.length > 0 && <span style={{ fontSize: 11.5, color: "var(--mod)" }}>{y.changes.length} change{y.changes.length > 1 ? "s" : ""}</span>}
                {y.remote && <span className="mono" style={{ fontSize: 11, color: "var(--dimmer)" }}>{y.remote}</span>}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 32, display: "flex", alignItems: "center", gap: 8 }}>
          {[null, ...pages, DIFF].map((f) => (
            <span key={f ?? ""} className="linkish" onClick={() => setTab(f)} title={f ?? where}
              style={{ padding: "3px 10px", borderRadius: 999, fontSize: 12.5, color: tab === f ? "var(--fg)" : "var(--dim)", fontWeight: tab === f ? 500 : 400,
                background: tab === f ? "color-mix(in srgb, var(--acc) 18%, transparent)" : "transparent" }}>{f === DIFF ? "Diff" : f ? f.replace(/\.html?$/i, "") : "Report"}</span>
          ))}
          <span className="spacer" />
          <button className="ib" title="Pop out into its own window" onClick={() => popOut(x.id, tab)}><I n="ph-arrow-square-up-right" /></button>
          <button className="ib" title="Refresh" onClick={() => setN((k) => k + 1)}><I n="ph-arrows-clockwise" /></button>
        </div>
        <div style={{ marginTop: 10 }}>
          {cfg && <ProjectTab id={x.id} cfg={cfg} tab={tab} n={n} repos={(cfg.repos || []).map((id) => mine.find((y) => y.id === id)).filter(Boolean)} say={say} />}
        </div>
      </div>
    </div>
  );
}

/** Shown when every repo is in reserve: bring back what you need. */
export function ReserveHome({ collapsed, groupHead, lastSet, openAdd, openCtx, park, reserveCtx, restoreSet, rgroups, root, used }) {
  return (
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
  );
}

/** First run with no repos at all: the three setup steps. */
export function Onboarding({ obSteps }) {
  return (
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
  );
}
