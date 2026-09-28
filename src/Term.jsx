import { useEffect, useRef } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { cssVar } from "./themes.js";

// ANSI colours stay put; the surface follows the app theme
const theme = () => ({
  ...ANSI, background: cssVar("--bg"), foreground: cssVar("--code"), cursor: cssVar("--acc"), cursorAccent: cssVar("--bg"), selectionBackground: cssVar("--badge"),
});
const ANSI = {
  black: "#292b31", brightBlack: "#595d6c", red: "#e8837a", brightRed: "#f0a39b", green: "#8fcf9c", brightGreen: "#aee0b8",
  yellow: "#e2c07e", brightYellow: "#ecd39f", blue: "#8fb7e0", brightBlue: "#b0cdea", magenta: "#b5abfc", brightMagenta: "#d2cefd",
  cyan: "#7fcfcf", brightCyan: "#a6e0e0", white: "#cfd3e5", brightWhite: "#e9e9ed",
};

/** One shell tab. Unmounting only lets go of the shell (it keeps running and can be mounted again, in either window);
 * App's closeTerm ends it. `bg` tints the surface (popped-out terminals get their own colour). */
export default function Term({ tab, repo, cmd, visible, bg, onExit, onEnter }) {
  const box = useRef(), fit = useRef(), term = useRef();
  const cb = useRef();
  cb.current = { onExit, onEnter };
  const colours = () => ({ ...theme(), ...(bg && { background: bg, cursorAccent: bg }) });
  cb.current.colours = colours;

  useEffect(() => {
    const t = new Terminal({ theme: colours(), fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, lineHeight: 1.35, cursorBlink: true, allowProposedApi: true });
    const f = new FitAddon();
    t.loadAddon(f);
    t.attachCustomKeyEventHandler((e) => !(e.ctrlKey && e.code === "Backquote")); // let the app toggle the panel and pop-outs
    t.open(box.current);
    term.current = t; fit.current = f;
    let dead = false;
    document.fonts.ready.then(() => {
      if (dead) return;
      f.fit();
      const out = new Channel();
      out.onmessage = (buf) => {
        if (dead) return; // unmounted: the shell now talks to another Term
        const bytes = new Uint8Array(buf);
        if (bytes.length) t.write(bytes);
        else cb.current.onExit();
      };
      invoke("pty_open", { tab, id: repo, cols: t.cols, rows: t.rows, out })
        .then((again) => !again && cmd && invoke("pty_write", { tab, data: cmd + "\r" }))
        .catch((e) => t.write(`\x1b[31m${e}\x1b[0m\r\n`));
    });
    const input = t.onData((d) => {
      invoke("pty_write", { tab, data: d }).catch(() => {});
      if (d.includes("\r")) cb.current.onEnter();
    });
    const resize = t.onResize(({ cols, rows }) => invoke("pty_resize", { tab, cols, rows }).catch(() => {}));
    const clear = (e) => e.detail === tab && t.clear();
    window.addEventListener("nb-term-clear", clear);
    const repaint = () => { t.options.theme = cb.current.colours(); };
    window.addEventListener("nb-theme", repaint);
    const ro = new ResizeObserver(() => box.current?.offsetParent && f.fit());
    ro.observe(box.current);
    return () => { dead = true; window.removeEventListener("nb-term-clear", clear); window.removeEventListener("nb-theme", repaint); ro.disconnect(); input.dispose(); resize.dispose(); t.dispose(); };
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (term.current) term.current.options.theme = colours(); }, [bg]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (visible) { fit.current?.fit(); term.current?.focus(); } }, [visible]);

  return <div ref={box} style={{ display: visible ? "block" : "none", flex: 1, minHeight: 0, padding: "2px 0 6px 20px" }} />;
}
