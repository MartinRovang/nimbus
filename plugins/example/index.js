// A Nimbus plugin: copy this folder to ~/.config/nimbus/plugins/example and reload Nimbus.
export function activate(nimbus) {
  // A command in the palette (Ctrl+K)
  nimbus.addCommand({
    label: "Show CI runs",
    icon: "ph-rocket-launch",
    run: () => {
      const repo = nimbus.state().repo;
      if (!repo) return nimbus.toast("Open a repo first", true);
      nimbus.terminal("gh run list --limit 10", repo.id);
    },
  });

  // Right-click entries on files and in the editor
  const blame = ({ repo, path }) => nimbus.terminal(`git blame -- '${path.replace(/'/g, "'\\''")}' | less`, repo);
  nimbus.addMenuItem("file", { label: "Blame in terminal", icon: "ph-user-list", run: blame });
  nimbus.addMenuItem("editor", { label: "Blame in terminal", icon: "ph-user-list", run: blame });

  // A status bar item that follows the active repo
  const last = nimbus.addStatusItem({ text: "", icon: "ph-clock-counter-clockwise", title: "Last commit on this branch" });
  const refresh = async (repo) => {
    if (!repo?.git) return last.update({ text: "" });
    const when = await nimbus.git(repo.id, "log", "-1", "--format=%cr").catch(() => "");
    last.update({ text: when.trim() });
  };
  nimbus.on("repo", refresh);
  nimbus.on("commit", () => refresh(nimbus.state().repo));

  // A theme: set the same variables as the built-in Nimbus theme
  nimbus.addTheme({
    id: "rose", name: "Rosé", dark: true,
    vars: {
      "--bg": "#1c1519", "--fg": "#f1e6ea", "--pop": "#2a1f25", "--code": "#e7d8de",
      "--acc": "#e58fb0", "--acc-fg": "#f6c3d6", "--acc-soft": "#efa9c3", "--acc-ink": "#2a0f1a", "--acc-strong": "#b85d82", "--chip": "#3b2530", "--badge": "#6e3a52",
      "--dim": "#8f7c86", "--dimmer": "#65545d", "--mid": "#ad99a3", "--soft": "#cdb9c3", "--border": "#4a3a42", "--border2": "#33272d", "--gold": "#f2c98a",
      "--mod": "oklch(0.82 0.09 80)", "--add": "oklch(0.8 0.1 150)", "--del": "oklch(0.74 0.12 25)",
      "--syn-kw": "#e58fb0", "--syn-str": "#f2c98a", "--syn-num": "#f6c3d6", "--syn-fn": "#fff0f5", "--syn-type": "#a7c7e7", "--syn-com": "#8f7c86", "--syn-punc": "#ad99a3",
    },
  });
}
