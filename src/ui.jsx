// Small pieces every part of the app draws with: icons, the token renderer, checkboxes, segmented buttons, resizers.
import { invoke } from "@tauri-apps/api/core";
import { tok } from "./lib.js";

export const ST = { M: "var(--mod)", A: "var(--add)", D: "var(--del)", R: "var(--mod)", U: "var(--del)" };
export const ADD_BG = "color-mix(in srgb, var(--add) 9%, transparent)", DEL_BG = "color-mix(in srgb, var(--del) 10%, transparent)", EMPTY_BG = "color-mix(in srgb, var(--fg) 1.8%, transparent)";
export const PRC = { open: "var(--add)", merged: "var(--acc-soft)", draft: "var(--mid)", closed: "var(--del)" };
export const CHK = { pass: ["ph-check-circle", "var(--add)"], fail: ["ph-x-circle", "var(--del)"], pending: ["ph-circle-dashed", "var(--mod)"] };
export const LANG = { ts: "TypeScript", tsx: "TypeScript React", js: "JavaScript", jsx: "JavaScript React", json: "JSON", md: "Markdown", rs: "Rust", py: "Python", go: "Go", toml: "TOML", yml: "YAML", yaml: "YAML", css: "CSS", html: "HTML", sh: "Shell", swift: "Swift", tf: "HCL" };
export const MAC = navigator.platform.startsWith("Mac");
export const K = MAC ? "⌘" : "Ctrl+", SH = MAC ? "⇧" : "Shift+";
export const EMPTY = { id: "", remote: "", branch: "", branches: [], changes: [], commits: [], stashes: [], git: true };
export const KEYS = [["Files", K + "1"], ["Changes", K + "2"], ["Pull requests", K + "3"], ["Issues", K + "4"], ["Search all repos", K + SH + "F"], ["Switch branch", K + SH + "B"], ["Add repo or folder", K + "O"],
  ["Review changes with AI", K + SH + "R"], ["Commit", K + "Enter"], ["Toggle sidebar", K + "\\"], ["Command palette", K + "K"], ["Settings", K + ","],
  ["Terminal", "⌃`"], ["Hide popped-out terminals", "⌃⇧`"], ["Keyboard shortcuts", K + "/"], ["Close", "Esc"]];
export const keyRows = KEYS.map(([a, b]) => [<span key={a}>{a}</span>, <span key={a + "k"}>{b}</span>]);
export const ISSUE_FIELDS = "number,title,state,author,labels,assignees,createdAt,body,url,comments";
export const PR_FIELDS = "number,title,headRefName,baseRefName,author,state,isDraft,reviewDecision,reviewRequests,statusCheckRollup,createdAt,body,files,url";

export const git = (id, ...args) => invoke("git", { id, args });
export const gh = (id, ...args) => invoke("gh", { id, args });
export const Toks = ({ code }) => tok(code).map((t, i) => <span key={i} style={{ color: t.c, fontStyle: t.s }}>{t.t}</span>);
export const I = ({ n, style }) => <i className={"ph " + n} style={style} />;

/** A drag handle on a panel edge. `grow` is +1 when dragging right/down makes the panel bigger. */
export function Resizer({ axis, grow, value, min, max, set, reset, style }) {
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

export const Check = ({ on, onClick, title }) => <span className={"check" + (on ? " on" : "")} onClick={onClick} title={title}>{on && <I n="ph-check" />}</span>;
export const seg = (opts) => (
  <div className="seg">{opts.map(([label, on, pick]) => <button key={label} className={on ? "on" : ""} onClick={pick}>{label}</button>)}</div>
);
/** How a repo's branch chip and sync count look in the sidebar. */
export const bInfo = (x) => {
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
