// Dual-screen mode: every terminal tiled in a window of its own (index.html?view=terms), for a second monitor.
// App in the main window owns the list and sends it here as `nb-terms`; this window asks for changes with events back.
import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Term from "./Term.jsx";
import { I } from "./ui.jsx";
import { autoGrid, hueOf, pastel } from "./lib.js";
import { settings, store, applySettings } from "./settings.js";

const newTerm = () => emit("nb-term-new", { repo: null });

export default function TermWindow() {
  const [terms, setTerms] = useState(null); // null until the main window answers
  const [, repaint] = useState(0);
  useEffect(() => {
    const w = getCurrentWindow();
    // remember where it sits, so it reopens on the same monitor
    const place = async () => {
      const f = await w.scaleFactor(), p = (await w.outerPosition()).toLogical(f), s = (await w.innerSize()).toLogical(f);
      store.set("nb.termsWin", { x: p.x, y: p.y, w: s.width, h: s.height });
    };
    const un = [listen("nb-terms", (e) => setTerms(e.payload)), w.onCloseRequested(() => emit("nb-dual-off")), w.onMoved(place), w.onResized(place)];
    emit("nb-terms-hello");
    // settings belong to the main window: follow its theme whenever it saves them
    const sync = (e) => { if (e.key === "nb.settings") { Object.assign(settings, store.get("nb.settings", {})); applySettings(); repaint((n) => n + 1); } };
    const key = (e) => { if (e.ctrlKey && (e.code === "Backquote" || (e.shiftKey && e.code === "KeyT"))) { e.preventDefault(); newTerm(); } };
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
        <button className="ib" title="New terminal (⌃` or ⌃⇧T)" onClick={newTerm} style={{ width: 24, height: 24, borderRadius: 5 }}><I n="ph-plus" /></button>
        <button className="ghost" onClick={() => emit("nb-dual-off")} style={{ height: 24 }}><I n="ph-arrows-in-simple" />Back to one screen</button>
      </div>
      {!list.length ? (
        <div style={{ margin: "auto", color: "var(--dim)", fontSize: 13 }}>{terms ? "No terminals. ⌃⇧T or + opens one." : "Waiting for Nimbus…"}</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`, gap: 4, padding: "0 4px 4px" }}>
          {list.map((t) => {
            const c = pastel(hueOf(t.repo || "work"), dark), btn = { width: 22, height: 22, borderRadius: 5, color: c.ink };
            return (
              <div key={t.id} style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden", background: c.bg, border: `1px solid ${c.bar}`, borderRadius: 10 }}>
                <div style={{ height: 30, flex: "none", display: "flex", alignItems: "center", gap: 2, padding: "0 6px 0 12px", fontSize: 12, userSelect: "none", background: c.bar, color: c.ink }}>
                  <I n="ph-terminal" style={{ fontSize: 12, marginRight: 4 }} /><span className="ellip" style={{ fontWeight: 500 }}>{t.repo || "work"}</span>
                  <div className="spacer" />
                  <button className="ib" title="Clear" onClick={() => window.dispatchEvent(new CustomEvent("nb-term-clear", { detail: t.id }))} style={btn}><I n="ph-broom" /></button>
                  <button className="ib" title="Close terminal" onClick={() => emit("nb-term-close", { id: t.id })} style={btn}><I n="ph-x" /></button>
                </div>
                <Term tab={t.id} repo={t.repo} cmd={t.cmd} bg={c.bg} visible onExit={() => emit("nb-term-close", { id: t.id })} onEnter={() => emit("nb-term-enter", { repo: t.repo })} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
