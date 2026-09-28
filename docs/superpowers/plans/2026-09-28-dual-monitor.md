# Dual-monitor Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "terminals on their own screen" mode: every terminal tiled in a second OS window, the main window left to repos, branches and diffs, and running shells kept alive when switching.

**Architecture:** In Rust, each PTY's output goes to a swappable `Out`, which holds a channel plus a 256 KB scrollback, so any window can re-attach to a running shell with `pty_open`. The main window's `App` stays the owner of the `terms` list. It sends the list to a `?view=terms` webview (`TermWindow`) over Tauri events, and receives new/close/enter/off requests back from it.

**Tech Stack:** Tauri 2.11 (Rust, portable-pty), React 19, xterm 6, `@tauri-apps/api` (`event`, `window`, `webviewWindow`).

**Spec:** `docs/superpowers/specs/2026-09-28-dual-monitor-design.md`

## Global Constraints

- Scrollback per shell: 256 KB (`SCROLLBACK = 256 * 1024`).
- Terminal window label is `terms`, URL `index.html?view=terms`, title `Nimbus — Terminals`.
- The setting is `dualScreen: boolean` in `nb.settings`, default `false`. Only the main window writes `nb.settings`. The terminal window stores its geometry under its own key, `nb.termsWin` = `{ x, y, w, h }` (logical px).
- Event names: `nb-terms`, `nb-terms-hello`, `nb-term-new`, `nb-term-close`, `nb-term-enter`, `nb-dual-off`.
- An empty channel message means "the shell exited". Never send one for anything else.
- No new npm or cargo dependencies.
- Match the surrounding style: terse one-line helpers, `/** */` doc comments on functions, `ponytail:` comments for known shortcuts.
- `App.jsx` already imports a plugin `emit` from `./plugins.js`. Import Tauri's as `emit as emitEvent`.

## Review Focus

1. **The user closes the terminal window with the window manager's close button.** The terminals should come back docked in the main window, with the shells still running and their scrollback visible. (Manual check, Task 5, step 6)
2. **A shell exits while it's moving between windows.** Its tile or pane should disappear, not stay stuck on a dead prompt. (Rust unit test `out_replays_and_reports_exit`, Task 1)
3. **Re-attaching to a shell with no output yet.** It must not look like an exit. (Covered by the same test's first assertion, Task 1)
4. **A full-screen TUI (vim, `claude`) is running when the mode switches.** The screen may look stale until the TUI redraws. We accept that ceiling. (Manual check, Task 5, step 6; noted in a `ponytail:` comment in Task 1)
5. **Changing the theme in Settings while the mode is on.** The terminal window repaints to match. (Manual check, Task 5, step 6)

---

### Task 1: Re-attachable PTYs with scrollback (Rust)

**Files:**
- Modify: `src-tauri/src/lib.rs` (imports at lines 1-12, the terminal section at lines 363-434, tests after line 950)

**Interfaces:**
- Produces: the Tauri command `pty_open(tab: u32, id: Option<String>, cols: u16, rows: u16, out: Channel) -> Result<bool, String>`. It returns `true` when it re-attached to a shell that was already running (the caller must then **not** re-send its startup command). `pty_write`, `pty_resize` and `pty_close` are unchanged.

- [ ] **Step 1: Write the failing tests**

Add these inside `mod tests` in `src-tauri/src/lib.rs`, after `shell_runs_in_pty`:

```rust
    /// A channel that records every message, like a window would receive them.
    fn sink() -> (Channel<InvokeResponseBody>, Arc<Mutex<Vec<Vec<u8>>>>) {
        let got = Arc::new(Mutex::new(Vec::new()));
        let g = got.clone();
        (Channel::new(move |b| { if let InvokeResponseBody::Raw(v) = b { g.lock().unwrap().push(v); } Ok(()) }), got)
    }
    fn text(got: &Mutex<Vec<Vec<u8>>>) -> String { String::from_utf8_lossy(&got.lock().unwrap().concat()).into() }
    fn until(f: impl Fn() -> bool) {
        for _ in 0..100 { if f() { return; } std::thread::sleep(std::time::Duration::from_millis(50)); }
        panic!("timed out");
    }

    #[test]
    fn out_replays_and_reports_exit() {
        let mut o = Out::default();
        let (a, got_a) = sink();
        o.attach(a);
        assert!(got_a.lock().unwrap().is_empty(), "nothing to replay, and no empty message: that reads as exit");
        o.push(b"hello ");
        let (b, got_b) = sink();
        o.attach(b);
        o.push(b"world");
        assert_eq!(text(&got_a), "hello ", "the old window stops receiving");
        assert_eq!(text(&got_b), "hello world", "the new one gets the replay, then live output");
        o.push(&vec![b'x'; SCROLLBACK]);
        assert_eq!(o.buf.len(), SCROLLBACK, "scrollback is capped");
        o.finish();
        assert!(got_b.lock().unwrap().last().unwrap().is_empty(), "exit signal to the attached window");
        let (c, got_c) = sink();
        o.attach(c);
        let msgs = got_c.lock().unwrap();
        assert_eq!((msgs.len(), msgs[1].is_empty()), (2, true), "attaching after exit: replay, then the exit signal");
    }

    #[test]
    fn shell_keeps_running_across_windows() {
        let (mut p, reader) = spawn_shell(&std::env::temp_dir(), None, 80, 24).unwrap();
        let (a, _) = sink();
        p.out.lock().unwrap().attach(a);
        let o = p.out.clone();
        std::thread::spawn(move || pump(reader, o));
        p.writer.write_all(b"echo mide-$((40+2))\r").unwrap();
        until(|| String::from_utf8_lossy(&p.out.lock().unwrap().buf.iter().copied().collect::<Vec<_>>()).contains("mide-42"));
        let (b, got_b) = sink();
        p.out.lock().unwrap().attach(b);
        p.writer.write_all(b"echo again-$((1+1))\r").unwrap();
        until(|| text(&got_b).contains("again-2"));
        let _ = p.child.kill();
        assert!(text(&got_b).contains("mide-42"), "earlier output replayed to the second window");
    }
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd src-tauri && cargo test out_replays_and_reports_exit shell_keeps_running_across_windows`
Expected: compile errors: `Out`, `SCROLLBACK`, `pump`, `Arc` and the field `out` are not defined.

- [ ] **Step 3: Implement**

In the imports at the top of `lib.rs`, change the `std` block to:

```rust
use std::{
    collections::{HashMap, VecDeque},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
};
```

Replace everything from `struct Pty {` down to the end of `fn pty_open` (keeping `size` and `spawn_shell`, apart from the one-line change to `spawn_shell` below) so the section reads:

```rust
struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    out: Arc<Mutex<Out>>,
}

#[derive(Default)]
struct Ptys(Mutex<HashMap<u32, Pty>>);

/// Output kept per shell, replayed when another window attaches (the terminals window in dual-screen mode).
// ponytail: a raw byte replay; a full-screen app (vim, claude) looks stale until it redraws. A headless
// terminal emulator per shell would restore the exact screen.
const SCROLLBACK: usize = 256 * 1024;

/// Where a shell's output goes: the attached window's channel, and always the scrollback.
#[derive(Default)]
struct Out {
    chan: Option<Channel<InvokeResponseBody>>,
    buf: VecDeque<u8>,
    done: bool,
}

impl Out {
    fn push(&mut self, bytes: &[u8]) {
        self.buf.extend(bytes);
        let over = self.buf.len().saturating_sub(SCROLLBACK);
        self.buf.drain(..over);
        if self.chan.as_ref().is_some_and(|c| c.send(InvokeResponseBody::Raw(bytes.to_vec())).is_err()) {
            self.chan = None; // that window is gone; keep buffering for the next one
        }
    }
    /// The shell ended: tell the attached window (an empty message), or the next one that attaches.
    fn finish(&mut self) {
        self.done = true;
        if let Some(c) = self.chan.take() {
            let _ = c.send(InvokeResponseBody::Raw(vec![]));
        }
    }
    /// Replays the scrollback to `chan` and sends it everything from now on.
    fn attach(&mut self, chan: Channel<InvokeResponseBody>) {
        if !self.buf.is_empty() {
            let (a, b) = self.buf.as_slices();
            let _ = chan.send(InvokeResponseBody::Raw([a, b].concat()));
        }
        if self.done {
            let _ = chan.send(InvokeResponseBody::Raw(vec![]));
        } else {
            self.chan = Some(chan);
        }
    }
}

/// Copies a shell's output into `out` until it exits.
fn pump(mut reader: Box<dyn Read + Send>, out: Arc<Mutex<Out>>) {
    let mut buf = [0u8; 16384];
    while let Ok(n) = reader.read(&mut buf) {
        if n == 0 {
            break;
        }
        out.lock().unwrap().push(&buf[..n]);
    }
    out.lock().unwrap().finish();
}
```

In `spawn_shell`, change its last line to construct `out`:

```rust
    Ok((Pty { master: pair.master, writer, child, out: Arc::default() }, reader))
```

Replace `pty_open` with:

```rust
/// Opens a shell for `tab`, or re-attaches to its running one (it moved to another window). Bytes arrive on `out`,
/// and an empty message means the shell exited. Returns true when it re-attached.
#[tauri::command]
fn pty_open(ptys: tauri::State<Ptys>, tab: u32, id: Option<String>, cols: u16, rows: u16, out: Channel<InvokeResponseBody>) -> Result<bool, String> {
    let mut map = ptys.0.lock().unwrap();
    if let Some(p) = map.get(&tab) {
        let _ = p.master.resize(size(cols, rows));
        p.out.lock().unwrap().attach(out);
        return Ok(true);
    }
    let (pty, reader) = spawn_shell(&cwd(id.clone())?, id.as_deref(), cols, rows)?;
    pty.out.lock().unwrap().attach(out);
    let o = pty.out.clone();
    map.insert(tab, pty);
    std::thread::spawn(move || pump(reader, o));
    Ok(false)
}
```

Lock order is always `ptys`, then `out`. `pump` takes only `out`, so this can't deadlock.

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd src-tauri && cargo test`
Expected: all tests pass, including `shell_runs_in_pty`, `out_replays_and_reports_exit` and `shell_keeps_running_across_windows`. `review_runs_claude` stays ignored.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "Keep a scrollback per shell and let pty_open re-attach to a running one"
```

---

### Task 2: Grid and colour helpers (`lib.js`)

**Files:**
- Modify: `src/lib.js` (after `GRIDS`, around line 184)
- Test: `src/lib.test.js`

**Interfaces:**
- Produces: `autoGrid(n: number) -> { cols: number, rows: number }` and `hueOf(s?: string) -> number` (an integer in 0..359, the same for the same string).

- [ ] **Step 1: Write the failing test**

In `src/lib.test.js`, add `autoGrid, hueOf` to the import from `./lib.js`, and append:

```js
test("dual-screen tiling and repo colours", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 7, 10].map((n) => { const g = autoGrid(n); return `${g.cols}x${g.rows}`; }),
    ["1x1", "1x1", "2x1", "2x2", "2x2", "3x2", "3x3", "4x3"]);
  const h = hueOf("nimbus");
  assert.ok(h >= 0 && h < 360 && Number.isInteger(h));
  assert.equal(hueOf("nimbus"), h);
  assert.notEqual(hueOf("api"), h);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test`
Expected: FAIL, `autoGrid is not a function` (or a SyntaxError for a missing export).

- [ ] **Step 3: Implement**

In `src/lib.js`, right after `export const GRIDS = …`:

```js
/** Columns × rows for n tiles in the dual-screen terminals window: as square as it gets, wider than tall. */
export const autoGrid = (n) => { const cols = Math.ceil(Math.sqrt(n)) || 1; return { cols, rows: Math.ceil(n / cols) || 1 }; };
/** A fixed hue per repo name, so a repo's terminals keep one colour. */
export const hueOf = (s = "") => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib.js src/lib.test.js
git commit -m "Add autoGrid and hueOf for the terminals window"
```

---

### Task 3: `Term` only detaches; `App.closeTerm` ends the shell

This task changes nothing you can see in single-window mode. Its point is that unmounting a `Term` no longer kills its shell.

**Files:**
- Modify: `src/Term.jsx` (lines 18-19, 36-45, 59)
- Modify: `src/App.jsx` (`closeTerm`, around line 719)

**Interfaces:**
- Consumes: `pty_open` returning `bool` (Task 1).
- Produces: a `<Term tab repo cmd visible bg onExit onEnter />` that can be unmounted and mounted again with the same `tab`, in any window, without restarting the shell. `closeTerm(id)` in `App` is now the only thing that kills a shell.

- [ ] **Step 1: Edit `Term.jsx`**

Replace the two doc comment lines above `export default function Term` with:

```js
/** One shell tab. Unmounting only lets go of the shell (it keeps running and can be mounted again, in either window);
 * App's closeTerm ends it. `bg` tints the surface (popped-out terminals get their own colour). */
```

In the effect, ignore output once unmounted, and don't replay `cmd` on re-attach:

```js
      out.onmessage = (buf) => {
        if (dead) return; // unmounted: the shell now talks to another Term
        const bytes = new Uint8Array(buf);
        if (bytes.length) t.write(bytes);
        else cb.current.onExit();
      };
      invoke("pty_open", { tab, id: repo, cols: t.cols, rows: t.rows, out })
        .then((again) => !again && cmd && invoke("pty_write", { tab, data: cmd + "\r" }))
        .catch((e) => t.write(`\x1b[31m${e}\x1b[0m\r\n`));
```

In the cleanup, delete `invoke("pty_close", { tab });` so it ends with `… t.dispose(); };`.

- [ ] **Step 2: Edit `App.closeTerm`**

```js
  const closeTerm = (id) => {
    invoke("pty_close", { tab: id });
    setTerms((ts) => {
      const rest = ts.filter((t) => t.id !== id);
      if (!rest.some((t) => !t.float)) setTermOpen(false);
      return rest;
    });
  };
```

- [ ] **Step 3: Verify in the app**

Run: `npm install` (if `node_modules` is missing), then `npm run tauri dev`.
Check:
- Open a terminal and run `sleep 1000 &`. Close the terminal with its ×, then run `pgrep -f "sleep 1000"` in another terminal. It should print nothing (the shell and its job are gone).
- Open a terminal and type `exit`. The pane closes.
- Enable the example plugin (Settings → Plugins) and run its "gh run list" command on a repo. The command runs once, not twice (dev mode mounts every effect twice under StrictMode, so this is where a re-attach bug would show up).

- [ ] **Step 4: Commit**

```bash
git add src/Term.jsx src/App.jsx
git commit -m "Unmounting a terminal no longer kills its shell; closeTerm does"
```

---

### Task 4: The terminal window (`TermWindow`)

**Files:**
- Create: `src/TermWindow.jsx`
- Modify: `src/main.jsx`
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: `autoGrid`, `hueOf`, `pastel` from `lib.js` (Task 2); `Term` (Task 3); `settings`, `store`, `applySettings` from `settings.js`; `I` from `ui.jsx`.
- Produces: a window labelled `terms` that listens for `nb-terms` (payload `[{ id, repo, cmd }]`) and emits `nb-terms-hello` (no payload), `nb-term-new` `{ repo: null }`, `nb-term-close` `{ id }`, `nb-term-enter` `{ repo }` and `nb-dual-off` (no payload).

- [ ] **Step 1: Capabilities**

`src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window and the dual-screen terminals window",
  "windows": [
    "main",
    "terms"
  ],
  "permissions": [
    "core:default",
    "core:webview:allow-create-webview-window",
    "core:window:allow-set-focus",
    "core:window:allow-close",
    "core:window:allow-destroy",
    "dialog:allow-open",
    "updater:default"
  ]
}
```

(`allow-destroy` is what `onCloseRequested` calls to finish closing. `core:default` already allows events and reading position and size.)

- [ ] **Step 2: Route `?view=terms` in `main.jsx`**

Add `import TermWindow from "./TermWindow.jsx";` next to the `Boot` import, and render:

```jsx
// the dual-screen terminals window skips the update check and the app shell
const Root = new URLSearchParams(location.search).get("view") === "terms" ? TermWindow : Boot;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
```

- [ ] **Step 3: Create `src/TermWindow.jsx`**

```jsx
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
    const key = (e) => { if (e.ctrlKey && e.code === "Backquote") { e.preventDefault(); newTerm(); } };
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
        <button className="ib" title="New terminal (⌃`)" onClick={newTerm} style={{ width: 24, height: 24, borderRadius: 5 }}><I n="ph-plus" /></button>
        <button className="ghost" onClick={() => emit("nb-dual-off")} style={{ height: 24 }}><I n="ph-arrows-in-simple" />Back to one screen</button>
      </div>
      {!list.length ? (
        <div style={{ margin: "auto", color: "var(--dim)", fontSize: 13 }}>{terms ? "No terminals. ⌃` or + opens one." : "Waiting for Nimbus…"}</div>
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
```

- [ ] **Step 4: Build to catch import and syntax errors**

Run: `npm run build`
Expected: the build succeeds. The window can't be opened from the UI yet (that's Task 5).

- [ ] **Step 5: Commit**

```bash
git add src/TermWindow.jsx src/main.jsx src-tauri/capabilities/default.json
git commit -m "Add the dual-screen terminals window"
```

---

### Task 5: Dual-screen mode in the main window

**Files:**
- Modify: `src/settings.js` (`DEFAULTS`)
- Modify: `src/App.jsx` (imports; `toggleTerm`; a new block after `termEnter`, around line 801; the palette `cmds`; the `<Terminals>` and `<StatusBar>` render lines around 999 and 1015)
- Modify: `src/Panels.jsx` (`StatusBar`, lines 314 and 334-335)
- Modify: `src/Terminals.jsx` (props and the pane context menu)
- Modify: `src/Settings.jsx` (the Editor section, after "Terminal snapping", line 104)

**Interfaces:**
- Consumes: everything `TermWindow` emits and listens to (Task 4), and `closeTerm`/`newTerm`/`termEnter` (Task 3 and the existing code).
- Produces: `dual` (boolean, read from `settings.dualScreen`), `setDual(on: boolean)` and `focusTerms()` inside `App`, plus the props `dual`, `focusTerms` on `StatusBar` and `toDual` on `Terminals`.

- [ ] **Step 1: Setting default**

In `src/settings.js`, add `dualScreen: false` to `DEFAULTS` (after `termGrid: "3x2"`).

- [ ] **Step 2: App: imports**

```js
import { emit as emitEvent, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
```

- [ ] **Step 3: App: the mode, window and sync**

Add this right after the `termEnter` line (it must stay above the `if (!wf) return` near line 885, because hooks can't come after an early return):

```js
  // ---- dual screen: every terminal in a window of its own (TermWindow) for a second monitor; App keeps the list ----
  const dual = !!settings.dualScreen;
  const setDual = (on) => { saveSettings({ dualScreen: on }); setTick((n) => n + 1); if (on && !terms.length) newTerm(); };
  const termsWin = () => WebviewWindow.getByLabel("terms");
  const focusTerms = () => termsWin().then((w) => w?.setFocus());
  useEffect(() => {
    if (!dual) { termsWin().then((w) => w?.close()); return; }
    termsWin().then((w) => {
      if (w) return w.setFocus();
      const g = store.get("nb.termsWin", {});
      new WebviewWindow("terms", { url: "index.html?view=terms", title: "Nimbus — Terminals", width: g.w ?? 1100, height: g.h ?? 760, minWidth: 480, minHeight: 320, ...(g.x != null && { x: g.x, y: g.y }) });
    });
  }, [dual]); // eslint-disable-line react-hooks/exhaustive-deps
  const termsNow = useRef(terms);
  termsNow.current = terms;
  const sendTerms = () => emitEvent("nb-terms", termsNow.current.map(({ id, repo, cmd }) => ({ id, repo, cmd })));
  useEffect(() => { if (dual) sendTerms(); }, [dual, terms]); // eslint-disable-line react-hooks/exhaustive-deps
  const fromTerms = useRef();
  fromTerms.current = { newTerm, closeTerm, termEnter, setDual, sendTerms };
  useEffect(() => {
    const on = (name, f) => listen(name, (e) => f(fromTerms.current, e.payload));
    const un = [
      on("nb-terms-hello", (h) => h.sendTerms()),
      on("nb-term-new", (h, p) => h.newTerm("", p?.repo ?? undefined)),
      on("nb-term-close", (h, p) => h.closeTerm(p.id)),
      on("nb-term-enter", (h, p) => h.termEnter(p.repo)),
      on("nb-dual-off", (h) => h.setDual(false)),
    ];
    return () => un.forEach((p) => p.then((f) => f()));
  }, []);
```

When the app starts with `dualScreen` already on, the `[dual]` effect runs on mount and opens the window. Closing the window from the main side (`w.close()`) fires the window's `onCloseRequested`, which emits `nb-dual-off`, which calls `setDual(false)` again. That's harmless.

- [ ] **Step 4: App: ⌃\`, palette and render**

`toggleTerm` becomes:

```js
  const toggleTerm = () => (dual ? newTerm() : terms.some((t) => !t.float && mine(t)) ? setTermOpen((o) => !o) : newTerm());
```

`toggleTerm` is defined before `dual`, but it only reads `dual` when called, after render, so that's fine. (Keep `const dual` above the `useEffect`s that use it, as in Step 3.)

In `paletteItems` `cmds`, after "New terminal":

```js
      { icon: "ph-browsers", label: dual ? "Terminals back in this window" : "Terminals on their own screen", run: go(() => setDual(!dual)) },
```

Render the `Terminals` line only in single-window mode, and pass the new props:

```jsx
          {!dual && <Terminals {...{ closeTerm, dock, dragPane, floatsHidden, inArea, mine, newTerm, openCtx, popOut, resetSize, setTick, sizer, sizes, snap, termArea, termEnter, termOpen, terms, toggleTerm }} toDual={() => setDual(true)} />}
```

```jsx
      <StatusBar {...{ open, cur, dual, floatsHidden, focusTerms, hits, push, r, runUpdate, say, search, searchBox, searchOpen, searching, setSearchOpen, setSq, showOv, sq, terms, toggleFloats, toggleTerm, update, user }} />
```

- [ ] **Step 5: StatusBar, Terminals menu, Settings row**

`src/Panels.jsx`: add `dual, focusTerms` to `StatusBar`'s destructured props, and replace the two terminal spans (lines 334-335) with:

```jsx
      {dual
        ? <span className="linkish" onClick={focusTerms} title="Bring the terminals window forward" style={{ display: "flex", alignItems: "center", gap: 5 }}><I n="ph-browsers" style={{ fontSize: 12 }} />{terms.length} on the other screen</span>
        : <span className="linkish" onClick={toggleTerm} style={{ display: "flex", alignItems: "center", gap: 5 }}><I n="ph-terminal-window" style={{ fontSize: 12 }} />Terminal</span>}
      {!dual && floatsHidden && <span className="linkish" onClick={toggleFloats} title="Show popped-out terminals (⌃⇧`)" style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--acc-soft)" }}><I n="ph-eye" style={{ fontSize: 12 }} />{terms.filter((t) => t.float).length} hidden</span>}
```

`src/Terminals.jsx`: add `toDual` to the destructured props, and in the pane's context menu, after the Pop out / Dock item:

```js
                { icon: "ph-browsers", label: "Move terminals to their own window", run: toDual },
```

`src/Settings.jsx`: after the "Terminal snapping" row:

```jsx
            <Row label="Terminals on their own screen" sub="Every terminal tiled in a separate window for a second monitor; this window keeps the repos and changes">
              <span className={"check" + (settings.dualScreen ? " on" : "")} onClick={() => set({ dualScreen: !settings.dualScreen })}>{settings.dualScreen && <I n="ph-check" />}</span>
            </Row>
```

(`set` calls `changed()`, which bumps `App`'s tick, so `App` sees the new `settings.dualScreen` and the `[dual]` effect opens or closes the window.)

- [ ] **Step 6: Verify in the app (covers Review Focus 1, 4 and 5)**

Run: `npm test && (cd src-tauri && cargo test) && npm run tauri dev`
Check each of these:
1. Open two terminals in repo A and one in repo B, run `npm run dev` (or `top`) in one, and pop one of them out. Palette → "Terminals on their own screen". A second window opens with 3 tiles (2×2 grid), tinted by repo, and the running process keeps printing. The main window has no bottom panel, and the status bar shows "3 on the other screen".
2. In the main window, press ⌃\`. A 4th tile appears in the terminal window, for the active repo.
3. In the terminal window, press ⌃\` and click +. New tiles appear. × closes a tile, and `exit` in a tile also closes it.
4. Change the theme in the main window's Settings. The terminal window repaints (the chrome and the xterm background).
5. Move the terminal window to the second monitor and resize it, then close it with the window manager's ×. The terminals are back in the main window, docked/popped as before, with the shells alive and scrollback visible.
6. Turn the mode on again. The window opens where you left it. Quit Nimbus with the mode on and start it again: the terminal window reopens (with no terminals, since shells don't survive a restart).
7. With `vim` open in a tile, toggle the mode off and on. Note whether it redraws; a stale screen until the next keypress is the accepted ceiling.
8. Turn the mode off with Settings → "Terminals on their own screen". The window closes, and the terminals are back.

- [ ] **Step 7: Commit**

```bash
git add src/settings.js src/App.jsx src/Panels.jsx src/Terminals.jsx src/Settings.jsx
git commit -m "Dual-screen mode: terminals in their own window, main window keeps repos and changes"
```
