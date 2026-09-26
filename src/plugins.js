// Plugins: folders in ~/.config/nb/plugins/<id>/ holding plugin.json and an ES module (index.js by
// default) that exports `activate(nb)`. They run inside the app with the access it has, like editor
// extensions, so only install ones you trust. The API is below; README.md has an example.
import { invoke } from "@tauri-apps/api/core";

/** What plugins have added. `version` bumps on every change so React can re-read it. */
export const reg = { version: 0, list: [], commands: [], themes: [], status: [], menus: { repo: [], file: [], editor: [] } };
const listeners = new Set(), events = {};
const bump = () => { reg.version++; listeners.forEach((f) => f()); };
export const subscribe = (f) => { listeners.add(f); return () => listeners.delete(f); };
const add = (arr, x) => { arr.push(x); bump(); return () => { const i = arr.indexOf(x); if (i >= 0) arr.splice(i, 1); bump(); }; };

/** The app fills this in on every render: state(), openFile(), terminal(), toast(). */
export const host = {};

/** Tells plugins something happened: "repo" (active repo changed), "file" (opened), "commit", "review". */
export function emit(event, data) {
  for (const f of events[event] || []) {
    try { f(data); } catch (e) { console.error(`[nb plugin] ${event} handler failed`, e); }
  }
}

function api(id) {
  const tag = (x) => ({ ...x, plugin: id });
  return {
    /** A palette entry: { label, icon?, hint?, run() }. Returns a function that removes it. */
    addCommand: (c) => add(reg.commands, tag(c)),
    /** A theme: { id, name, dark, vars } with the same variables as the built-in Nimbus theme. */
    addTheme: (t) => add(reg.themes, tag(t)),
    /** A right-click entry on "repo", "file" or "editor": { label, icon?, run({ repo, path }) }. */
    addMenuItem: (where, item) => add(reg.menus[where], tag(item)),
    /** Text in the status bar: { text, icon?, title?, run? }. Returns { update(fields), remove() }. */
    addStatusItem: (item) => {
      const it = tag(item);
      const remove = add(reg.status, it);
      return { update: (fields) => { Object.assign(it, fields); bump(); }, remove };
    },
    /** Subscribe to "repo", "file", "commit" or "review". */
    on: (event, fn) => { (events[event] ||= []).push(fn); },
    /** { root, repo: { id, branch, remote, changes } | null, file: { repo, path } | null } */
    state: () => host.state(),
    git: (repo, ...args) => invoke("git", { id: repo, args }),
    gh: (repo, ...args) => invoke("gh", { id: repo, args }),
    readFile: (repo, path) => invoke("read_file", { id: repo, path }),
    openFile: (repo, path) => host.openFile(repo, path),
    /** Opens a terminal tab (in `repo`, or the active one) and runs `cmd` in it. */
    terminal: (cmd, repo) => host.terminal(cmd, repo),
    toast: (text, isError) => host.toast(text, isError),
  };
}

/** Loads every enabled plugin once, at startup. `off` holds the ids switched off in Settings. */
export async function loadPlugins(off) {
  const list = await invoke("plugins").catch(() => []);
  for (const p of list) {
    p.enabled = !off.includes(p.id);
    if (!p.enabled || p.error) continue;
    const url = URL.createObjectURL(new Blob([p.source], { type: "text/javascript" }));
    try {
      const mod = await import(/* @vite-ignore */ url);
      const activate = mod.activate || mod.default;
      if (typeof activate !== "function") throw new Error("exports no activate(nb) function");
      await activate(api(p.id));
    } catch (e) {
      p.error = String(e?.message || e);
      console.error(`[nb plugin] ${p.id}`, e);
    } finally {
      URL.revokeObjectURL(url);
      delete p.source;
    }
  }
  reg.list = list;
  bump();
}
