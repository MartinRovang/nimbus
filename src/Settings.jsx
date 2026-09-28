// Settings: look, editor, workfolder, accounts, plugins, updates.
import { useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { settings, saveSettings, allThemes } from "./settings.js";
import { GRIDS } from "./lib.js";
/** "3x2" -> "3×2" */
export const gridName = (g) => (g === "off" ? "Off" : g === "edges" ? "Edges" : g.replace("x", "×"));
import { reg, subscribe } from "./plugins.js";

const I = ({ n, style }) => <i className={"ph " + n} style={style} />;

/** Theme cards with a tiny preview of each: sidebar, accent, a few lines of code. */
export function ThemePicker({ value, onPick }) {
  useSyncExternalStore(subscribe, () => reg.version);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(128px,1fr))", gap: 10 }}>
      {allThemes().map((t) => {
        const v = t.vars, on = t.id === value;
        return (
          <button key={t.id} onClick={() => onPick(t.id)} title={t.plugin ? `From plugin ${t.plugin}` : t.name}
            style={{ padding: 0, border: 0, borderRadius: 10, cursor: "pointer", background: "transparent", textAlign: "left", boxShadow: on ? "0 0 0 2px var(--acc)" : "0 0 0 1px var(--border)" }}>
            <div style={{ height: 64, borderRadius: "10px 10px 0 0", background: v["--bg"], display: "flex", overflow: "hidden" }}>
              <div style={{ width: 18, borderRight: `1px solid ${v["--border2"]}`, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, paddingTop: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: v["--acc"] }} /><span style={{ width: 8, height: 8, borderRadius: 2, background: v["--dimmer"] }} />
              </div>
              <div style={{ flex: 1, padding: "9px 8px", display: "flex", flexDirection: "column", gap: 5 }}>
                {[["--syn-kw", 30, "--code", 40], ["--syn-str", 55], ["--syn-fn", 24, "--syn-com", 34], ["--acc", 44]].map((row, i) => (
                  <div key={i} style={{ display: "flex", gap: 4 }}>
                    <span style={{ height: 4, width: row[1] + "%", borderRadius: 2, background: v[row[0]] }} />
                    {row[2] && <span style={{ height: 4, width: row[3] + "%", borderRadius: 2, background: v[row[2]] }} />}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: "0 0 10px 10px", background: "var(--pop)", color: on ? "var(--fg)" : "var(--soft)", fontSize: 12 }}>
              <span style={{ flex: 1 }}>{t.name}</span>{on && <I n="ph-check" style={{ color: "var(--acc)" }} />}
            </div>
          </button>
        );
      })}
    </div>
  );
}

const Section = ({ title, children }) => (
  <div style={{ padding: "18px 0", borderTop: "1px solid var(--line)" }}>
    <div className="label" style={{ marginBottom: 12 }}>{title}</div>
    {children}
  </div>
);
const Row = ({ label, sub, children }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 34, marginTop: 6 }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div>{label}</div>
      {sub && <div className="ellip" style={{ fontSize: 12, color: "var(--dim)", marginTop: 2 }}>{sub}</div>}
    </div>
    {children}
  </div>
);
const seg = (opts, value, pick) => (
  <div className="seg">{opts.map(([v, label]) => <button key={v} className={v === value ? "on" : ""} onClick={() => pick(v)}>{label}</button>)}</div>
);

export default function Settings({ close, say, openWizard, checkNow, update, runUpdate, reload, whatsNew, groups, newGroup, renameGroup, deleteGroup, changed }) {
  useSyncExternalStore(subscribe, () => reg.version);
  const [, rerender] = useState(0);
  const [st, setSt] = useState(null);
  const [version, setVersion] = useState("");
  const [off, setOff] = useState(settings.pluginsOff);
  const set = (patch) => { saveSettings(patch); rerender((n) => n + 1); changed(); };
  const [dayInput, setDayInput] = useState("");
  const addDays = () => {
    const d = Math.round(Number(dayInput));
    if (!(d > 0 && d <= 365)) return say("Use a number of days from 1 to 365", true);
    set({ reserveDays: [...new Set([...settings.reserveDays, d])].sort((a, b) => a - b) });
    setDayInput("");
  };
  useEffect(() => { invoke("setup_status").then(setSt); getVersion().then(setVersion, () => {}); checkNow(true); }, []);
  const changeRoot = async () => {
    const p = await pickFolder({ directory: true }).catch(() => null);
    if (!p) return;
    try { await invoke("set_root", { path: p }); setSt(await invoke("setup_status")); reload(); say("Workfolder is now " + p.replace(/^\/home\/[^/]+/, "~")); } catch (e) { say(e, true); }
  };
  const togglePlugin = (id) => { const next = off.includes(id) ? off.filter((x) => x !== id) : [...off, id]; setOff(next); saveSettings({ pluginsOff: next }); };
  const pluginsChanged = off.join() !== reg.list.filter((p) => !p.enabled).map((p) => p.id).join();

  return (
    <>
      <div className="scrim" onClick={close} style={{ zIndex: 30, background: "rgba(10,11,18,0.6)" }} />
      <div className="pop" style={{ position: "absolute", top: "6%", left: "50%", transform: "translateX(-50%)", width: 620, maxWidth: "calc(100% - 32px)", maxHeight: "88%", zIndex: 31, borderRadius: 14, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 16px 12px 22px" }}>
          <I n="ph-gear-six" style={{ color: "var(--acc)", fontSize: 16 }} /><span style={{ fontSize: 16, fontWeight: 500, flex: 1 }}>Settings</span>
          <button className="ib" title="Close" onClick={close}><I n="ph-x" /></button>
        </div>
        <div style={{ overflow: "auto", padding: "0 22px 8px", minHeight: 0 }}>
          <Section title="Appearance">
            <ThemePicker value={settings.theme} onPick={(theme) => set({ theme })} />
            <Row label="Code font size">{seg([[12, "12"], [13, "13"], [14, "14"], [15, "15"], [16, "16"]], settings.codeSize, (codeSize) => set({ codeSize }))}</Row>
          </Section>
          <Section title="Editor">
            <Row label="Diff view" sub="How a changed file opens">{seg([["unified", "Unified"], ["split", "Split"]], settings.diffStyle, (diffStyle) => set({ diffStyle }))}</Row>
            <Row label="Terminal snapping" sub="Where a popped-out terminal lands when you drop it: edges and corners, or a cell of a grid">{seg(GRIDS.map((g) => [g, gridName(g)]), settings.termGrid, (termGrid) => set({ termGrid }))}</Row>
            <Row label="Terminals on their own screen" sub="Every terminal tiled in a separate window for a second monitor; this window keeps the repos and changes">
              <span className={"check" + (settings.dualScreen ? " on" : "")} onClick={() => set({ dualScreen: !settings.dualScreen })}>{settings.dualScreen && <I n="ph-check" />}</span>
            </Row>
          </Section>
          <Section title="Workfolder">
            <Row label="Start each session empty" sub="Repos wait in reserve when Nimbus opens; restore the last set with one click">
              <span className={"check" + (settings.startEmpty ? " on" : "")} onClick={() => set({ startEmpty: !settings.startEmpty })}>{settings.startEmpty && <I n="ph-check" />}</span>
            </Row>
            <Row label={<span className="mono" style={{ fontSize: 12.5 }}>{st?.root || "…"}</span>} sub="Where cloned repos live; folders elsewhere are linked in">
              <button className="ghost" onClick={changeRoot} style={{ height: 30 }}><I n="ph-folder-open" />Change…</button>
            </Row>
          </Section>
          <Section title="Reserve">
            <Row label="Recent groups" sub="Repos you used within each window get their own group, after Last used">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {settings.reserveDays.map((d) => (
                  <span key={d} className="chip" style={{ gap: 6, padding: "3px 4px 3px 9px", borderRadius: 7, background: "var(--chip)", color: "var(--acc-fg)", fontSize: 12 }}>
                    {d} day{d === 1 ? "" : "s"}
                    <span className="ib" title="Remove" onClick={() => set({ reserveDays: settings.reserveDays.filter((x) => x !== d) })} style={{ width: 16, height: 16, fontSize: 10, borderRadius: 4 }}><I n="ph-x" /></span>
                  </span>
                ))}
                <form onSubmit={(e) => { e.preventDefault(); addDays(); }} style={{ display: "flex", gap: 4 }}>
                  <input value={dayInput} onChange={(e) => setDayInput(e.target.value)} inputMode="numeric" placeholder="days" aria-label="Add a window, in days"
                    style={{ width: 54, height: 26, padding: "0 8px", borderRadius: 7, border: 0, background: "transparent", boxShadow: "0 0 0 1px var(--border)", outline: "none", color: "var(--fg)", fontSize: 12 }} />
                  <button className="ghost" type="submit" style={{ height: 26, padding: "0 8px", fontSize: 12 }}><I n="ph-plus" />Add</button>
                </form>
              </div>
            </Row>
            <Row label="Your groups" sub={groups.length ? "Shown first in the reserve; right-click a repo to move it into one" : "Make your own, like Work or Side projects"}>
              <button className="ghost" onClick={newGroup} style={{ height: 30 }}><I n="ph-folder-simple-plus" />New group</button>
            </Row>
            {groups.map((g) => (
              <div key={g.name} style={{ display: "flex", alignItems: "center", gap: 8, height: 32, paddingLeft: 12 }}>
                <I n="ph-folder-simple-star" style={{ color: "var(--dim)" }} />
                <span style={{ flex: 1 }}>{g.name} <span style={{ color: "var(--dimmer)", fontSize: 12 }}>{g.repos.length} repo{g.repos.length === 1 ? "" : "s"}</span></span>
                <button className="ib" title="Rename" onClick={() => renameGroup(g.name)}><I n="ph-pencil-simple" /></button>
                <button className="ib" title="Delete group" onClick={() => deleteGroup(g.name)}><I n="ph-trash" /></button>
              </div>
            ))}
          </Section>
          <Section title="Accounts">
            <Row label="GitHub" sub={st ? (st.user ? `Connected as ${st.user} through gh` : st.gh ? "Not connected" : "GitHub CLI (gh) not installed") : "…"}>
              {st && !st.user && st.gh && <button className="btn" onClick={() => { close(); openWizard(); }}>Connect</button>}
            </Row>
            <Row label="Claude Code" sub={st ? (st.claude ? `${st.claude}, used for AI self-review` : "Not on PATH; install it to turn on reviews") : "…"} />
          </Section>
          <Section title="Plugins">
            {!reg.list.length && <div style={{ color: "var(--dim)", lineHeight: 1.55 }}>No plugins yet. A plugin is a folder with a <span className="mono">plugin.json</span> and an <span className="mono">index.js</span>; see the README for the API.</div>}
            {reg.list.map((p) => (
              <Row key={p.id} label={<>{p.name} <span style={{ color: "var(--dimmer)", fontSize: 12 }}>{p.version}</span></>} sub={p.error ? <span style={{ color: "var(--del)" }}>{p.error}</span> : p.description}>
                <span className={"check" + (off.includes(p.id) ? "" : " on")} title={off.includes(p.id) ? "Turn on" : "Turn off"} onClick={() => togglePlugin(p.id)}>{!off.includes(p.id) && <I n="ph-check" />}</span>
              </Row>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button className="ghost" onClick={() => invoke("open_plugins_dir").then((d) => say("Plugins live in " + d), (e) => say(e, true))} style={{ height: 30 }}><I n="ph-folder-open" />Open plugins folder</button>
              {pluginsChanged && <button className="btn" onClick={() => window.location.reload()}><I n="ph-arrow-clockwise" />Reload to apply</button>}
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--dim)", lineHeight: 1.5 }}>Plugins run with the same access as Nimbus itself (git, gh, your files, a terminal). Only add ones you trust. Reloading closes open terminals.</div>
          </Section>
          <Section title="About">
            <Row label={`Nimbus ${version}`} sub={update ? `Version ${update.version} is available` : "Updates install by themselves when Nimbus starts"}>
              {update
                ? <button className="btn" onClick={runUpdate} style={{ height: 30 }}><I n="ph-download-simple" />Update to {update.version}</button>
                : <button className="ghost" onClick={() => checkNow()} style={{ height: 30 }}><I n="ph-arrows-clockwise" />Check for updates</button>}
            </Row>
            <Row label="What's new" sub="Changes in this version">
              <button className="ghost" onClick={whatsNew} style={{ height: 30 }}><I n="ph-confetti" />Show</button>
            </Row>
            <Row label="Run the welcome again">
              <button className="ghost" onClick={() => { close(); openWizard(); }} style={{ height: 30 }}><I n="ph-sparkle" />Open</button>
            </Row>
          </Section>
        </div>
      </div>
    </>
  );
}
