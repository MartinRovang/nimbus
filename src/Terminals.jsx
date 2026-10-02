// The terminal panes. Their state and drag/snap logic live in App (see its terminal section).
import { I, Resizer } from "./ui.jsx";
import { pastel, cellRect, GRIDS } from "./lib.js";
import { settings, saveSettings } from "./settings.js";
import Term from "./Term.jsx";
import { gridName } from "./Settings.jsx";

/** Docked terminals side by side in the bottom panel, popped-out ones floating over the app with their own colour.
 * All stay in this one list, so docking or popping out never restarts a shell. */
export function Terminals({ closeTerm, dock, dragPane, floatsHidden, inArea, mine, newTerm, openCtx, popOut, resetSize, setTick, sizer, sizes, snap, termArea, termEnter, termOpen, terms, here, toDual, toggleTerm }) {
  const docked = terms.filter((t) => !t.float && mine(t)), shown = termOpen && docked.length > 0;
  const floats = terms.filter((t) => t.float && here(t)).sort((a, b) => a.float.z - b.float.z).map((t) => t.id);
  const dark = document.documentElement.style.colorScheme !== "light";
  return (
    <div style={{ flex: "none", position: "relative", display: "flex", height: shown ? sizes.term : 0, borderTop: shown ? "1px solid color-mix(in srgb, var(--fg) 7%, transparent)" : "none" }}>
      {shown && <Resizer axis="y" grow={-1} value={sizes.term} min={110} max={() => window.innerHeight * 0.75} set={sizer("term")} reset={resetSize("term")} style={{ top: -4 }} />}
      {terms.map((t) => {
        const f = t.float, c = f && pastel(f.hue, dark), last = !f && t.id === docked.at(-1)?.id;
        const btn = { width: 22, height: 22, borderRadius: 5, color: c ? c.ink : "var(--dim)" };
        return (
          <div key={t.id} data-snapped={f?.snapped ? t.id : undefined} style={f
            // the native corner handle (resize: both) sizes it; xterm refits through its ResizeObserver
            ? { position: "fixed", left: Math.min(f.x, window.innerWidth - 80), top: Math.min(f.y, window.innerHeight - 40), width: f.w, height: f.h, minWidth: 320, minHeight: 140, maxWidth: "100vw", maxHeight: "100vh", resize: "both", overflow: "hidden", zIndex: 10 + floats.indexOf(t.id), display: floatsHidden || !here(t) ? "none" : "flex", flexDirection: "column", background: c.bg, border: `1px solid ${c.bar}`, borderRadius: 10, boxShadow: "0 18px 50px rgba(0,0,0,.45)" }
            : { display: termOpen && mine(t) ? "flex" : "none", flexDirection: "column", flex: "1 1 0", minWidth: 0, borderLeft: t.id === docked[0]?.id ? "none" : "1px solid color-mix(in srgb, var(--fg) 7%, transparent)" }}>
            <div onPointerDown={(e) => dragPane(e, t)} title={f ? "Drag to move; drop on the bottom edge to dock" : "Drag up to pop out"}
              onContextMenu={(e) => openCtx(e, [
                { icon: "ph-plus", label: "New terminal", hint: "⌃`", run: newTerm },
                f ? { icon: "ph-arrow-square-down", label: "Dock at the bottom", run: () => dock(t) } : { icon: "ph-arrow-square-out", label: "Pop out", run: () => popOut(t) },
                { icon: "ph-browsers", label: "Move terminals to their own window", run: toDual },
                { icon: "ph-broom", label: "Clear", run: () => window.dispatchEvent(new CustomEvent("nb-term-clear", { detail: t.id })) },
                { sep: true },
                ...GRIDS.map((g) => ({ icon: settings.termGrid === g ? "ph-check" : "ph-grid-four", label: "Snap: " + gridName(g), run: () => { saveSettings({ termGrid: g }); setTick((n) => n + 1); } })),
                { sep: true },
                { icon: "ph-x", label: "Close terminal", danger: true, run: () => closeTerm(t.id) },
              ])}
              style={{ height: 30, flex: "none", display: "flex", alignItems: "center", gap: 2, padding: "0 6px 0 12px", fontSize: 12, userSelect: "none", cursor: f ? "move" : "default", background: c ? c.bar : "transparent", color: c ? c.ink : "var(--dim)" }}>
              <I n="ph-terminal" style={{ fontSize: 12, marginRight: 4 }} /><span className="ellip" style={{ fontWeight: f ? 500 : 400 }}>{t.repo || "work"}</span>
              <div className="spacer" />
              {last && <button className="ib" title="New terminal" onClick={() => newTerm()} style={btn}><I n="ph-plus" /></button>}
              <button className="ib" title={f ? "Dock at the bottom" : "Pop out"} onClick={() => (f ? dock(t) : popOut(t))} style={btn}><I n={f ? "ph-arrow-square-down" : "ph-arrow-square-out"} /></button>
              {last && <button className="ib" title="Hide terminals" onClick={toggleTerm} style={btn}><I n="ph-caret-down" /></button>}
              <button className="ib" title="Close terminal" onClick={() => closeTerm(t.id)} style={btn}><I n="ph-x" /></button>
            </div>
            <Term tab={t.id} repo={t.repo} cmd={t.cmd} sandbox={t.sandbox} bg={c?.bg} visible={f ? !floatsHidden && here(t) : termOpen && mine(t)} onExit={() => closeTerm(t.id)} onEnter={() => termEnter(t.repo)} />
          </div>
        );
      })}
      {/* while dragging: the grid's cells faintly, the target cell (or the dock) highlighted */}
      {snap && /^\d+x\d+$/.test(settings.termGrid) && (() => {
        const [cols, rows] = settings.termGrid.split("x").map(Number);
        return Array.from({ length: cols * rows }, (_, i) => {
          const a = termArea(), c = inArea(cellRect(i % cols, Math.floor(i / cols), cols, rows, a.w, a.h), a);
          return <div key={"cell" + i} style={{ position: "fixed", pointerEvents: "none", zIndex: 18, left: c.x, top: c.y, width: c.w, height: c.h, borderRadius: 10, border: "1px dashed color-mix(in srgb, var(--acc) 45%, transparent)" }} />;
        });
      })()}
      {snap && <div style={{ position: "fixed", pointerEvents: "none", zIndex: 19, borderRadius: 10, border: `2px solid ${snap.blocked ? "var(--del)" : "var(--acc)"}`, background: `color-mix(in srgb, ${snap.blocked ? "var(--del)" : "var(--acc)"} 12%, transparent)`, transition: "all .12s ease-out",
        ...(snap === "dock" ? { left: 4, right: 4, bottom: 30, height: Math.min(sizes.term, 240) } : { left: snap.x, top: snap.y, width: snap.w, height: snap.h }) }} />}
    </div>
  );
}
