// The AI self-review: a side panel while it runs and for follow-up questions, and a full report view.

export const SEV = { high: { c: "var(--del)", l: "High" }, med: { c: "var(--mod)", l: "Medium" }, low: { c: "var(--mid)", l: "Low" } };
const I = ({ n, style }) => <i className={"ph " + n} style={style} />;
const live = (rv) => rv.findings.filter((f) => !f.resolved);
const count = (rv, k) => live(rv).filter((f) => f.severity === k).length;

export function reportMarkdown(rv) {
  return [
    `# Self-review · ${rv.repo} (${rv.branch})`, "", `_${rv.label}, reviewed with Claude Code. Not posted anywhere unless you post it._`, "", rv.summary, "",
    ...rv.findings.map((f) => `- **${SEV[f.severity].l}** \`${f.path}:${f.line}\` — ${f.title}. ${f.detail}${f.resolved ? " _(resolved)_" : ""}` +
      (f.suggestion ? "\n  ```\n  " + f.suggestion.replace(/\n/g, "\n  ") + "\n  ```" : "")),
  ].join("\n");
}

export function ReviewPanel({ rv, q, setQ, ask, rerun, close, openReport, go, toggle }) {
  const cnt = ["high", "med", "low"].filter((k) => count(rv, k));
  return (
    <div style={{ width: 340, flex: "none", display: "flex", flexDirection: "column", borderLeft: "1px solid var(--line)", minHeight: 0 }}>
      <div className="head" style={{ gap: 8, padding: "0 8px 0 16px", borderBottom: "1px solid rgba(233,233,237,0.05)" }}>
        <I n="ph-sparkle" style={{ color: "var(--acc)" }} />
        <span style={{ fontWeight: 500, flex: "none" }}>Self-review</span>
        <span className="ellip" title={`${rv.label} · ${rv.repo}`} style={{ color: "var(--dim)", fontSize: 12, minWidth: 0, flex: 1 }}>{rv.label} · {rv.repo}</span>
        {rv.status === "done" && <button className="ib" title="Open full report" onClick={openReport} style={{ color: "var(--dim)" }}><I n="ph-article" /></button>}
        <button className="ib" title="Run again" onClick={rerun} style={{ color: "var(--dim)" }}><I n="ph-arrow-clockwise" /></button>
        <button className="ib" title="Close" onClick={close} style={{ color: "var(--dim)" }}><I n="ph-x" /></button>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "16px 16px 12px", minHeight: 0 }}>
        {rv.status === "running" && <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--mid)" }}><I n="ph-circle-notch spin" /><span>Claude is reading {rv.label}…</span></div>
          <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
            {[92, 68, 80].map((w) => <div key={w} style={{ height: 9, width: w + "%", borderRadius: 4, background: "rgba(233,233,237,0.05)" }} />)}
          </div>
          <div style={{ marginTop: 18, color: "var(--dimmer)", fontSize: 12, lineHeight: 1.5 }}>Runs <span className="mono">claude -p</span> in the repo with read-only tools. Usually under a minute or two.</div>
        </>}
        {rv.status === "error" && <div style={{ color: "var(--del)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{rv.err}</div>}
        {rv.status === "done" && <>
          <div style={{ color: "#cfd3e5", lineHeight: 1.55 }}>{rv.summary}</div>
          <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
            {cnt.map((k) => <span key={k} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--mid)", whiteSpace: "nowrap" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: SEV[k].c }} />{count(rv, k)} {SEV[k].l.toLowerCase()}</span>)}
          </div>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            {rv.findings.map((f) => (
              <div key={f.id} style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(233,233,237,0.025)", boxShadow: "inset 0 0 0 1px #292b31", opacity: f.resolved ? 0.45 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: SEV[f.severity].c }} />
                  <span style={{ color: SEV[f.severity].c, textTransform: "uppercase", letterSpacing: ".05em" }}>{SEV[f.severity].l}</span>
                  <span className="spacer" />
                  <span className="mono linkish" onClick={() => go(f)} style={{ color: "var(--dim)" }}>{f.path.split("/").pop()}:{f.line}</span>
                </div>
                <div style={{ marginTop: 6, fontWeight: 500, lineHeight: 1.35 }}>{f.title}</div>
                <div style={{ marginTop: 4, color: "var(--mid)", fontSize: 12.5, lineHeight: 1.5 }}>{f.detail}</div>
                {f.suggestion && <div className="mono" style={{ marginTop: 8, padding: "8px 10px", borderRadius: 6, background: "var(--bg)", fontSize: 11.5, color: "#cfd3e5", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{f.suggestion}</div>}
                <div style={{ marginTop: 8, display: "flex", gap: 2, marginLeft: -8 }}>
                  <button className="ghost" onClick={() => go(f)} style={{ height: 24, padding: "0 8px", borderRadius: 6, fontSize: 12 }}>Show in file</button>
                  <button className="ghost" onClick={() => toggle(f.id)} style={{ height: 24, padding: "0 8px", borderRadius: 6, fontSize: 12 }}>{f.resolved ? "Reopen" : "Resolve"}</button>
                </div>
              </div>
            ))}
          </div>
          {rv.qa.map((x, i) => (
            <div key={i} style={{ marginTop: 16 }}>
              <div style={{ color: "var(--acc-fg)", fontSize: 12.5 }}>{x.q}</div>
              <div style={{ marginTop: 6, color: "var(--soft)", fontSize: 12.5, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{x.a ?? <I n="ph-circle-notch spin" />}</div>
            </div>
          ))}
        </>}
      </div>
      <div style={{ flex: "none", padding: "10px 12px", borderTop: "1px solid rgba(233,233,237,0.05)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, height: 32, padding: "0 4px 0 10px", borderRadius: 8, boxShadow: "0 0 0 1px #3f424d", opacity: rv.session ? 1 : 0.5 }}>
          <input className="field" value={q} disabled={!rv.session} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); ask(); } }} placeholder="Ask about this review…" style={{ flex: 1, minWidth: 0, fontSize: 12.5 }} />
          <button className="ib" title="Ask" onClick={ask} style={{ color: "#b5abfc" }}><I n="ph-arrow-up" /></button>
        </div>
      </div>
    </div>
  );
}

export function Report({ rv, stats, pr, copy, download, post, close, go }) {
  const hi = count(rv, "high"), n = live(rv).length;
  const verdict = hi ? `Fix ${hi} issue${hi > 1 ? "s" : ""} before committing` : n ? "Ready to commit, with small notes" : "Ready to commit";
  const color = hi ? SEV.high.c : "var(--add)";
  const paths = [...new Set([...(rv.scope === "repo" ? [] : rv.paths), ...rv.findings.map((f) => f.path)])];
  const A = paths.reduce((a, p) => a + (stats[p]?.a || 0), 0), D = paths.reduce((a, p) => a + (stats[p]?.d || 0), 0);
  const tiles = [
    [String(paths.length), "files reviewed"], [`+${A} −${D}`, "lines changed"],
    [String(hi), "high", SEV.high.c], [String(count(rv, "med")), "medium", SEV.med.c], [String(count(rv, "low")), "low", SEV.low.c],
  ];
  return (
    <>
      <div className="head" style={{ gap: 8, padding: "0 12px 0 20px", borderBottom: "1px solid rgba(233,233,237,0.05)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}><span className="ellip" style={{ color: "var(--dim)" }}>{rv.repo}</span><span style={{ color: "#3f424d" }}>/</span><span>Report</span></div>
        <button className="ghost" title="Copy as Markdown" onClick={copy} style={{ height: 26, padding: "0 8px", borderRadius: 7, fontSize: 12 }}><I n="ph-copy" /></button>
        <button className="ghost" title="Save .md to Downloads" onClick={download} style={{ height: 26, padding: "0 8px", borderRadius: 7, fontSize: 12 }}><I n="ph-download-simple" /></button>
        {pr && <button className="btn" onClick={post} style={{ height: 26, padding: "0 10px", borderRadius: 7, fontSize: 12 }}><I n="ph-git-pull-request" />Post to #{pr.num}</button>}
        <button className="ib" title="Close" onClick={close} style={{ color: "var(--dim)" }}><I n="ph-x" /></button>
      </div>
      <div style={{ flex: 1, overflow: "auto", minHeight: 0, padding: "32px 40px 48px" }}>
        <div style={{ maxWidth: 760 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--dim)", flexWrap: "wrap", whiteSpace: "nowrap" }}>
            <I n="ph-sparkle" style={{ color: "var(--acc)" }} /><span>AI self-review</span><span>·</span><span className="mono" style={{ fontSize: 11.5 }}>{rv.branch}</span><span>·</span><span>{rv.label}</span><span>·</span><span>not posted</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 10px ${color}`, flex: "none" }} />
            <span style={{ fontSize: 24, fontWeight: 500, lineHeight: 1.25 }}>{verdict}</span>
          </div>
          <div style={{ marginTop: 10, color: "var(--soft)", lineHeight: 1.6, maxWidth: "62ch" }}>{rv.summary}</div>
          <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 1, borderRadius: 10, overflow: "hidden", background: "#292b31", boxShadow: "0 0 0 1px #292b31" }}>
            {tiles.map(([v, l, c]) => (
              <div key={l} style={{ background: "var(--bg)", padding: "12px 14px" }}>
                <div className="mono" style={{ fontSize: 18, fontWeight: 500, color: c }}>{v}</div>
                <div style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 2 }}>{l}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 32, display: "flex", flexDirection: "column", gap: 28 }}>
            {paths.map((p) => {
              const fs = rv.findings.filter((f) => f.path === p).sort((a, b) => a.line - b.line), parts = p.split("/"), name = parts.pop();
              return (
                <div key={p}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, paddingBottom: 8, borderBottom: "1px solid var(--line)" }}>
                    <I n="ph-file" style={{ color: "var(--dimmer)" }} /><span style={{ fontWeight: 500 }}>{name}</span>
                    <span className="ellip" style={{ color: "var(--dimmer)", fontSize: 12, minWidth: 0 }}>{parts.join("/")}</span>
                    <span className="spacer" />
                    {stats[p] && <><span className="mono" style={{ fontSize: 11, color: "var(--add)" }}>+{stats[p].a}</span><span className="mono" style={{ fontSize: 11, color: "var(--del)" }}>−{stats[p].d}</span></>}
                    <span style={{ fontSize: 11.5, color: fs.length ? "var(--soft)" : "var(--dimmer)", marginLeft: 8 }}>{fs.length ? `${fs.length} finding${fs.length > 1 ? "s" : ""}` : "clean"}</span>
                  </div>
                  {fs.map((f) => (
                    <div key={f.id} className="hov" onClick={() => go(f)} style={{ display: "grid", gridTemplateColumns: "72px 44px minmax(0,1fr)", gap: 12, padding: "12px 8px", margin: "0 -8px", borderRadius: 8, opacity: f.resolved ? 0.45 : 1 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: SEV[f.severity].c, height: 20 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: SEV[f.severity].c }} />{SEV[f.severity].l}</span>
                      <span className="mono" style={{ fontSize: 11.5, color: "var(--dim)", lineHeight: "20px" }}>L{f.line}</span>
                      <div>
                        <div style={{ lineHeight: "20px" }}>{f.title}{f.resolved && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--dim)" }}>resolved</span>}</div>
                        <div style={{ marginTop: 3, color: "var(--mid)", fontSize: 12.5, lineHeight: 1.55, maxWidth: "60ch" }}>{f.detail}</div>
                        {f.suggestion && <div className="mono" style={{ marginTop: 8, padding: "8px 12px", borderRadius: 6, background: "rgba(233,233,237,0.03)", boxShadow: "inset 2px 0 0 #5d5294", fontSize: 12, color: "#cfd3e5", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{f.suggestion}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
