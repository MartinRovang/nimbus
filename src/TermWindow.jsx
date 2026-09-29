// Dual-screen mode: every terminal tiled in a window of its own (index.html?view=terms), for a second monitor.
// App in the main window owns the list and sends it here as `nb-terms`; this window asks for changes with events back.
import { useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Term from "./Term.jsx";
import { I } from "./ui.jsx";
import { autoGrid, fuzzy, pastel, repoHue } from "./lib.js";
import { Palette } from "./Overlays.jsx";
import { settings, store, applySettings, saveSettings } from "./settings.js";

export default function TermWindow() {
  const [terms, setTerms] = useState(null); // null until the main window answers
  const [repos, setRepos] = useState({ repos: [], active: null });
  // a new terminal asks which repo first (the main window's active one on top); with no repos it opens in the workfolder
  const [q, setQ] = useState(null), [pIdx, setPIdx] = useState(0); // q is null while the prompt is closed
  const newTerm = useRef();
  newTerm.current = () => (repos.repos.length ? (setQ(""), setPIdx(0)) : emit("nb-term-new", { repo: null }));
  const pItems = q == null ? [] : [repos.active, ...repos.repos.filter((id) => id !== repos.active)].filter((id) => id && fuzzy(q, id))
    .map((id) => ({ icon: "ph-terminal", label: id, hint: id === repos.active ? "active" : "", run: () => { setQ(null); emit("nb-term-new", { repo: id }); } }));
  const pSel = Math.min(pIdx, Math.max(pItems.length - 1, 0));
  const [, repaint] = useState(0);
  const [menu, setMenu] = useState(false);
  const set = (patch) => { saveSettings(patch); repaint((n) => n + 1); };
  useEffect(() => {
    const w = getCurrentWindow();
    // remember where it sits, so it reopens on the same monitor
    const place = async () => {
      const f = await w.scaleFactor(), p = (await w.outerPosition()).toLogical(f), s = (await w.innerSize()).toLogical(f);
      store.set("nb.termsWin", { x: p.x, y: p.y, w: s.width, h: s.height });
    };
    const un = [listen("nb-terms", (e) => { setTerms(e.payload.terms); setRepos(e.payload); }), w.onCloseRequested(() => emit("nb-dual-off")), w.onMoved(place), w.onResized(place)];
    emit("nb-terms-hello");
    // settings belong to the main window: follow its theme whenever it saves them
    const sync = (e) => { if (e.key === "nb.settings") { Object.assign(settings, store.get("nb.settings", {})); applySettings(); repaint((n) => n + 1); } };
    const key = (e) => { if (e.key === "Escape") setQ(null); else if (e.ctrlKey && (e.code === "Backquote" || (e.shiftKey && e.code === "KeyT"))) { e.preventDefault(); newTerm.current(); } };
    window.addEventListener("storage", sync);
    window.addEventListener("keydown", key);
    return () => { un.forEach((p) => p.then((f) => f())); window.removeEventListener("storage", sync); window.removeEventListener("keydown", key); };
  }, []);

  const list = terms || [], { cols, rows } = autoGrid(list.length);
  const dark = document.documentElement.style.colorScheme !== "light";
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)", color: "var(--fg)" }}>
      <div style={{ height: 32, flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "0 8px 0 14px", fontSize: 12, color: "var(--dim)", userSelect: "none" }}>
        <I n="ph-terminal-window" />{list.length} terminal{list.length === 1 ? "" : "s"}
        <div className="spacer" />
        <button className="ib" title="New terminal (⌃` or ⌃⇧T)" onClick={() => newTerm.current()} style={{ width: 24, height: 24, borderRadius: 5 }}><I n="ph-plus" /></button>
        <button className="ib" title="Background" onClick={() => setMenu(!menu)} style={{ width: 24, height: 24, borderRadius: 5 }}><I n="ph-sliders-horizontal" /></button>
        <button className="ghost" onClick={() => emit("nb-dual-off")} style={{ height: 24 }}><I n="ph-arrows-in-simple" />Back to one screen</button>
      </div>
      {/* the site's animated sky behind the grid: plain wherever no terminal sits, faintly through the terminals' see-through tint */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", isolation: "isolate" }}>
      {settings.termSky && <iframe src="/sky/index.html" tabIndex={-1} aria-hidden="true" title="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, pointerEvents: "none", zIndex: -1 }} />}
      {!list.length ? (
        <div style={{ margin: "auto", fontSize: 13, ...(settings.termSky ? { color: "#fff", textShadow: "0 1px 6px rgba(0,0,0,.6)" } : { color: "var(--dim)" }) }}>{terms ? "No terminals. ⌃⇧T or + opens one." : "Waiting for Nimbus…"}</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`, gap: 4, padding: "0 4px 4px" }}>
          {list.map((t) => {
            const c = pastel(repoHue(t.repo || "work", repos.repos), dark), btn = { width: 22, height: 22, borderRadius: 5, color: c.ink };
            return (
              <div key={t.id} style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden", background: c.bg + Math.round(settings.termAlpha * 255).toString(16).padStart(2, "0") /* the sky shows through */, border: `1px solid ${c.bar}`, borderRadius: 10 }}>
                <div style={{ height: 30, flex: "none", display: "flex", alignItems: "center", gap: 2, padding: "0 6px 0 12px", fontSize: 12, userSelect: "none", background: c.bar, color: c.ink }}>
                  <I n="ph-terminal" style={{ fontSize: 12, marginRight: 4 }} /><span className="ellip" style={{ fontWeight: 500 }}>{t.repo || "work"}</span>
                  <div className="spacer" />
                  <button className="ib" title="Clear" onClick={() => window.dispatchEvent(new CustomEvent("nb-term-clear", { detail: t.id }))} style={btn}><I n="ph-broom" /></button>
                  <button className="ib" title="Close terminal" onClick={() => emit("nb-term-close", { id: t.id })} style={btn}><I n="ph-x" /></button>
                </div>
                <Term tab={t.id} repo={t.repo} cmd={t.cmd} bg={c.bg} glass visible onExit={() => emit("nb-term-close", { id: t.id })} onEnter={() => emit("nb-term-enter", { repo: t.repo })} />
              </div>
            );
          })}
        </div>
      )}
      </div>
      {menu && (
        <>
          <div className="scrim" onClick={() => setMenu(false)} style={{ zIndex: 30 }} />
          <div className="pop" style={{ position: "absolute", top: 34, right: 8, zIndex: 31, width: 260, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12, fontSize: 12.5 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1 }}>Animated sky</span>
              <span className={"check" + (settings.termSky ? " on" : "")} onClick={() => set({ termSky: !settings.termSky })}>{settings.termSky && <I n="ph-check" />}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1 }}>Terminals</span>
              <div className="seg">{[[0.7, "Clear"], [0.85, "Soft"], [1, "Solid"]].map(([v, l]) => <button key={v} className={settings.termAlpha === v ? "on" : ""} onClick={() => set({ termAlpha: v })}>{l}</button>)}</div>
            </div>
          </div>
        </>
      )}
      {q != null && <Palette {...{ pItems, pSel, q, setQ, setPIdx }} setOv={() => setQ(null)} placeholder="Open a terminal in…" />}
    </div>
  );
}
