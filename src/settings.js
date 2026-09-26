// User settings, kept in the webview's localStorage (per user, survives updates).
import { THEMES, applyTheme } from "./themes.js";
import { reg } from "./plugins.js";

export const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

export const SIZES = { side: 280, review: 340, term: 240 };
const DEFAULTS = { theme: "nimbus", codeSize: 13, diffStyle: "unified", pluginsOff: [], sizes: SIZES };
export const settings = { ...DEFAULTS, ...store.get("nb.settings", {}) };
settings.sizes = { ...SIZES, ...settings.sizes };

export const allThemes = () => [...THEMES, ...reg.themes];

/** Puts the saved look on the page. A plugin theme only exists once plugins have loaded. */
export function applySettings() {
  applyTheme(allThemes().find((t) => t.id === settings.theme) || THEMES[0]);
  document.documentElement.style.setProperty("--code-size", settings.codeSize + "px");
}

export function saveSettings(patch) {
  Object.assign(settings, patch);
  store.set("nb.settings", settings);
  applySettings();
}
