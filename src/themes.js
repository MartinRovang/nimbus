// Every colour in the UI is a CSS variable; a theme is one set of values for them.
// Plugins add more through nimbus.addTheme (see plugins.js); they must set the same keys as Nimbus.

const syn = (kw, str, num, fn, type, com, punc) => ({ "--syn-kw": kw, "--syn-str": str, "--syn-num": num, "--syn-fn": fn, "--syn-type": type, "--syn-com": com, "--syn-punc": punc });
const status = { "--mod": "oklch(0.82 0.09 80)", "--add": "oklch(0.8 0.1 150)", "--del": "oklch(0.74 0.12 25)" };

export const THEMES = [
  { id: "nimbus", name: "Nimbus", dark: true, vars: {
    "--bg": "#161826", "--fg": "#e9e9ed", "--pop": "#232532", "--code": "#cfd3e5",
    "--acc": "#9184d9", "--acc-fg": "#d2cefd", "--acc-soft": "#b5abfc", "--acc-ink": "#e7e5fe", "--acc-strong": "#5d5294", "--chip": "#2b2741", "--badge": "#423a6a",
    "--dim": "#75798c", "--dimmer": "#595d6c", "--mid": "#9397ab", "--soft": "#b2b6ca", "--border": "#3f424d", "--border2": "#292b31", "--gold": "#f2c98a",
    ...status, ...syn("#b5abfc", "oklch(0.82 0.07 80)", "#d2cefd", "#e7e5fe", "oklch(0.8 0.06 220)", "#75798c", "#9397ab"),
  } },
  { id: "solstice", name: "Solstice", dark: true, vars: {
    "--bg": "#17151f", "--fg": "#efe9df", "--pop": "#241f2b", "--code": "#e2dbe8",
    "--acc": "#e0b36a", "--acc-fg": "#f2d49c", "--acc-soft": "#e8c27e", "--acc-ink": "#1b1630", "--acc-strong": "#b88a44", "--chip": "#3a2f22", "--badge": "#6b5330",
    "--dim": "#857c8e", "--dimmer": "#5e566a", "--mid": "#a39aac", "--soft": "#c4bccc", "--border": "#463d4f", "--border2": "#2e2835", "--gold": "#f2c98a",
    ...status, ...syn("#e0b36a", "#b5abfc", "#f2d49c", "#fff3dc", "#9fd0e0", "#857c8e", "#a39aac"),
  } },
  { id: "aurora", name: "Aurora", dark: true, vars: {
    "--bg": "#0f1a1c", "--fg": "#e3efee", "--pop": "#182527", "--code": "#cfe2e0",
    "--acc": "#4fc1a6", "--acc-fg": "#9ae6d2", "--acc-soft": "#6fd3bb", "--acc-ink": "#eafff8", "--acc-strong": "#2d8a74", "--chip": "#16332d", "--badge": "#1f5a4c",
    "--dim": "#6f8a88", "--dimmer": "#4d6361", "--mid": "#8fa9a7", "--soft": "#b0c7c5", "--border": "#2d4341", "--border2": "#1f3230", "--gold": "#f2c98a",
    ...status, ...syn("#7fd6c2", "#e2c07e", "#9ae6d2", "#e3efee", "#8fb7e0", "#6f8a88", "#8fa9a7"),
  } },
  { id: "daylight", name: "Daylight", dark: false, vars: {
    "--bg": "#f7f6fb", "--fg": "#23222e", "--pop": "#ffffff", "--code": "#2b2a38",
    "--acc": "#6d5bd0", "--acc-fg": "#4b3bb0", "--acc-soft": "#6d5bd0", "--acc-ink": "#ffffff", "--acc-strong": "#6d5bd0", "--chip": "#ebe7fb", "--badge": "#6d5bd0",
    "--dim": "#6b6a7b", "--dimmer": "#9a99a8", "--mid": "#5b5a6b", "--soft": "#3f3e4e", "--border": "#d6d4e0", "--border2": "#e4e2ec", "--gold": "#b8862f",
    "--mod": "oklch(0.62 0.13 70)", "--add": "oklch(0.55 0.13 150)", "--del": "oklch(0.55 0.17 25)",
    ...syn("#6d5bd0", "#9a6a12", "#7a4fc0", "#3a3480", "#1f6f8b", "#8f8e9c", "#6b6a7b"),
  } },
];

export const KEYS = Object.keys(THEMES[0].vars);

/** Sets the theme's variables on the page and tells listeners (the terminal) to repaint. */
export function applyTheme(theme) {
  const s = document.documentElement.style;
  for (const k of KEYS) s.setProperty(k, theme.vars[k] ?? THEMES[0].vars[k]);
  s.colorScheme = theme.dark === false ? "light" : "dark";
  window.dispatchEvent(new CustomEvent("nb-theme"));
}

export const cssVar = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
