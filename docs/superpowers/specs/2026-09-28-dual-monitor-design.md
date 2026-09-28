# Dual-monitor mode

## Goal

Put every terminal on one screen and give the main window (repos, branches, diffs, PRs) the other screen, entirely to itself. Switching modes never kills a running shell.

## Decisions

- One extra OS window, labelled `terms`, that shows **all** terminals in an automatic grid, whatever repo is selected.
- Running shells survive switching the mode on or off: the PTY re-attaches to the other window and replays recent output.
- The main window's `App` stays the only owner of the `terms` list. The terminal window only displays it and sends requests back.

## Rust (`src-tauri/src/lib.rs`)

- `Pty` gains a scrollback ring buffer (last 256 KB of output) and a swappable output channel (`Arc<Mutex<Option<Channel>>>`). The reader thread appends to the buffer and sends to whichever channel is currently attached. With no channel attached, output is only buffered.
- `pty_open(tab, id, cols, rows, out)`: if `tab` already exists, attach `out`, replay the buffer, resize, and return. Otherwise spawn as now.
- No detach command. Re-attaching replaces the channel, and a failed send (its window is gone) drops the channel while buffering continues.
- `pty_close` is unchanged (kills the process). It's called from `App.closeTerm`, the only place a terminal really ends, and no longer from `Term`'s unmount.
- The exit signal (an empty message) goes to the channel attached at the time. If none is attached, the tab is marked dead, and the next `pty_open` for it sends the empty message right after the replay.
- An empty scrollback is never replayed, because an empty message reads as "exited"
- `capabilities/default.json`: `windows` becomes `["main", "terms"]`, and gains the window permissions needed to create, focus and close a webview window from JS.

## Frontend

### `Term.jsx`
- Unmounting only disposes the xterm and ignores any later output on its channel. It no longer calls `pty_close`.
- `pty_open` handles both a new shell and re-attaching.

### Mode switch (`App.jsx`)
- The setting `dualScreen: boolean` is persisted through `saveSettings`.
- Turning it on: the main window stops rendering `Terminals` (so its `Term`s unmount, and their shells keep running), and the main window creates the `terms` window with `new WebviewWindow("terms", { url: "index.html?view=terms", title: "Nimbus — Terminals" })`. Tauri's window-state defaults restore its position; if they don't, we save the position and size in settings from `onMoved`/`onResized`. If there are no terminals, one opens for the active repo.
- Turning it off (the button, or closing the terms window): the terms window closes, and the main window renders `Terminals` again. Float/dock state was never changed, so each terminal goes back where it was.
- When the app starts with `dualScreen` on, the terms window opens automatically.
- Entry points: a command palette item, a Settings toggle, the terminal context menu ("Move terminals to their own window"), and a status-bar indicator ("⧉ N terminals") that focuses the terms window.
- While the mode is on, the main window does not render `Terminals`. `newTerm`, `closeTerm` and the plugin `terminal()` API keep working against `terms`.

### Sync (Tauri events)
| Event | Direction | Payload |
|---|---|---|
| `nb-terms` | main → terms | `[{id, repo, cmd}]` (sent on every change) |
| `nb-terms-hello` | terms → main | — (main replies with `nb-terms`) |
| `nb-term-new` | terms → main | `{repo}` (`null` means the active repo) |
| `nb-term-close` | terms → main | `{id}` |
| `nb-term-enter` | terms → main | `{repo}` (refreshes git status, like `termEnter`) |
| `nb-dual-off` | terms → main | — |

A command `cmd` is written to the PTY only on first spawn: `Term` already does this after `pty_open` resolves, so it must skip it when re-attaching. `pty_open` returns `true` when it attached to an existing shell.

### `TermWindow.jsx` (new)
- `main.jsx` renders `TermWindow` instead of `App` when `?view=terms`.
- A thin top bar with **+** (new terminal for the active repo), a count, and "Back to one screen".
- The tiles come from `autoGrid(n)` in `lib.js` (1→1×1, 2→2×1, 3–4→2×2, 5–6→3×2, 7–9→3×3, then more columns), laid out with CSS grid. Each tile has a header like the existing one (repo name, Clear and Close buttons) and is tinted with the repo's pastel colour.
- ⌃\` opens a new terminal.
- The theme follows settings in `localStorage`: apply on load, re-apply on `storage` events.
- No drag, snap or floating.

## Out of scope
- Rearranging tiles by hand or resizing tiles in the terminal window.
- More than one terminal window.
- Remembering which monitor the window is on beyond what the saved position gives.

## Testing
- Rust: a real shell echoes a marker, a second channel attaches, and it receives the replayed marker plus new output. Also a unit test of the buffer: replay, cap, exit before and after attach, and no empty replay.
- `lib.test.js`: `autoGrid` for n = 1, 2, 3, 4, 5, 7, 10.
- Manual, with `npm run tauri dev` on two monitors: toggle the mode while `npm run dev` runs in a shell (it keeps running, scrollback is visible), make a terminal from the main window (it shows up in the terms window), close the terms window (the terminals dock back), and restart the app with the mode on (the window reopens where it was).
