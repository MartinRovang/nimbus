// One of a project's tabs (report, a page, the diff) popped out into a window of its own (index.html?view=project&project=<id>&tab=<tab>).
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ProjectTab } from "./Main.jsx";
import { I } from "./ui.jsx";

export default function ProjectWindow({ id, tab }) {
  const [cfg, setCfg] = useState(null), [repos, setRepos] = useState([]), [n, setN] = useState(0), [err, setErr] = useState("");
  useEffect(() => { const t = setInterval(() => setN((k) => k + 1), 10000); return () => clearInterval(t); }, []);
  // the project file and its repos as they are now (branch, changes), read fresh on every tick
  useEffect(() => {
    let dead = false;
    invoke("read_file", { id, path: ".nimbus-project.json" }).then(JSON.parse).catch(() => ({})).then(async (c) => {
      const rs = tab === ":diff" || (!tab && c.kind === "writer") ? await Promise.all((c.repos || []).map((r) => invoke("repo", { id: r }).catch(() => null))) : [];
      if (!dead) { setCfg((o) => (JSON.stringify(o) === JSON.stringify(c) ? o : c)); setRepos(rs.filter(Boolean)); }
    });
    return () => { dead = true; };
  }, [id, tab, n]);
  const name = tab === ":diff" ? "Diff against main" : tab ? tab.replace(/\.html?$/i, "") : cfg?.kind === "writer" ? "Text" : cfg?.kind === "experiment" ? "Results" : "Report";
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)", color: "var(--fg)" }}>
      <div className="head" style={{ gap: 8, padding: "0 10px 0 16px", flex: "none" }}>
        <I n="ph-folder-simple-star" style={{ color: "var(--acc)" }} />
        <span style={{ fontWeight: 500 }}>{id}</span><span className="label">{name}</span>
        {err && <span style={{ fontSize: 11.5, color: "var(--del)" }}>{err}</span>}
        <span className="spacer" />
        <button className="ib" title="Refresh" onClick={() => setN((k) => k + 1)}><I n="ph-arrows-clockwise" /></button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 10px 10px" }}>
        {cfg && <ProjectTab id={id} cfg={cfg} tab={tab} n={n} repos={repos} say={(e) => setErr(String(e))} height="100%" />}
      </div>
    </div>
  );
}
