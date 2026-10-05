// A writer project's text: every text file changed on the branch (or the files the project names) as tracked changes (word by word, from git's own word diff),
// against main or one commit at a time.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { I, seg, git, mainOf, mergeBase } from "./ui.jsx";
import { splitDiff, parseWordDiff, allAdded, PROSE, PROSE_RE } from "./lib.js";

// quotePath off: a name like læring.md comes back as typed, not octal-escaped
const wdiff = (id, specs, ...range) => git(id, "-c", "core.quotePath=false", "diff", "--word-diff=porcelain", "--no-renames", "-U99999", ...range, "--", ...specs);

/** One repo's text files (specs: git pathspecs) between two points (range: what git diff takes). withNew: also the files git doesn't track yet, as all inserted. */
const filesOf = async (x, specs, range, withNew) => {
  const parts = splitDiff(await wdiff(x.id, specs, ...range));
  const got = Object.entries(parts).map(([path, d]) => ({ repo: x.id, path, gone: /^deleted file mode/m.test(d), ...parseWordDiff(d) }));
  const fresh = !withNew ? [] : await Promise.all((await git(x.id, "ls-files", "--others", "--exclude-standard", "-z", "--", ...specs)).split("\0").filter(Boolean)
    .map((path) => invoke("read_file", { id: x.id, path }).then((t) => ({ repo: x.id, path, ...allAdded(t) }), () => ({ repo: x.id, path, lines: [], added: 0, removed: 0 }))));
  return [...got, ...fresh];
};

const dim = { padding: 20, color: "var(--dim)" };

export function Writer({ repos, files: named, n, height = 560 }) {
  const specs = named?.length ? named : PROSE, skey = specs.join("\n");
  const [mode, setMode] = useState("main"), [at, setAt] = useState(0), [sel, setSel] = useState(null);
  const [info, setInfo] = useState(null); // per repo: { base, commits: [{ repo, sha, ct, msg }], dirty } or { err }
  const [got, setGot] = useState(null);   // { v, files: [{ repo, path, lines, added, removed, gone }], err }
  const rkey = repos.map((x) => x.id + x.branch + x.changes.length).join();
  useEffect(() => {
    let dead = false;
    Promise.all(repos.filter((x) => x.git).map(async (x) => {
      try {
        const base = await mergeBase(x), log = await git(x.id, "log", "--reverse", "--format=%h%x09%ct%x09%s", base + "..HEAD", "--", ...specs);
        const dirty = !!(await git(x.id, "status", "--porcelain", "--untracked-files=all", "--", ...specs)).trim();
        return [x.id, { base, dirty, commits: log.split("\n").filter(Boolean).map((l) => { const [sha, ct, ...m] = l.split("\t"); return { repo: x.id, sha, ct: +ct, msg: m.join("\t") }; }) }];
      } catch (e) { return [x.id, { err: String(e), commits: [] }]; }
    })).then((rs) => !dead && setInfo(Object.fromEntries(rs)));
    return () => { dead = true; };
  }, [rkey, skey, n]); // eslint-disable-line react-hooks/exhaustive-deps
  // the steps: every commit that touched the text, oldest first across the repos, then what isn't committed yet
  const ok = repos.filter((x) => x.git && info?.[x.id] && !info[x.id].err);
  const wip = ok.some((x) => info[x.id].dirty);
  const steps = [...ok.flatMap((x) => info[x.id].commits).sort((a, b) => a.ct - b.ct), ...(wip ? [{ wip: true }] : [])];
  const step = steps[Math.min(at, steps.length - 1)];
  // v: what is on screen; k: that, as the repos are now. A refresh (k) keeps the text showing until the new one is in, so reading isn't interrupted every tick
  const v = mode === "main" ? "main" : step ? (step.wip ? "wip" : step.repo + step.sha) : "none";
  const k = info && [v, rkey, skey, n].join("\n");
  useEffect(() => {
    if (!k) return;
    let dead = false;
    const work = v === "none" ? Promise.resolve([])
      : mode === "main" ? Promise.all(ok.map((x) => filesOf(x, specs, [info[x.id].base], true)))
      : step.wip ? Promise.all(ok.map((x) => filesOf(x, specs, ["HEAD"], true)))
      : filesOf(repos.find((x) => x.id === step.repo), specs, [step.sha + "^", step.sha], false);
    work.then((fs) => ({ v, files: fs.flat() }), (e) => ({ v, files: [], err: String(e) })).then((g) => !dead && setGot(g));
    return () => { dead = true; };
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!repos.length) return <div style={{ color: "var(--dim)" }}>None of this project's repos are out of reserve.</div>;
  const files = got?.v === v ? got.files : null;
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
            : <div className={"prose" + (PROSE_RE.test(f.path) ? "" : " mono code")}>
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
