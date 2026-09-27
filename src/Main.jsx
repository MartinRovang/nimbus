// What fills the editor area: the open file, a PR, an issue, or the empty-workfolder screens.
import { memo } from "react";
import { I, bInfo, Toks, ST, PRC, CHK, gh, ADD_BG, DEL_BG, EMPTY_BG } from "./ui.jsx";
import { ago, splitRows } from "./lib.js";

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
  return (
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
            {pr.state === "open" && <button className="ghost" onClick={() => requestReview(pr)}><I n="ph-user-plus" />Request review</button>}
            <button className="ghost" onClick={() => act(r.id, () => stashAnd(r.id, pr.head, () => gh(r.id, "pr", "checkout", String(pr.num))), "Switched to " + pr.head)}>Check out branch</button>
            <button className="ghost" onClick={() => gh(r.id, "pr", "view", String(pr.num), "--web").catch((e) => say(e, true))}><I n="ph-arrow-square-out" />GitHub</button>
          </div>
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
