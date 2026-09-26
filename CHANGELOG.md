# Changelog

Each release gets a `## <version> — <date>` section. nb shows the new sections once after it updates, and `release.sh` uses the section as the GitHub release notes.

## 0.3.0 — 2026-09-26
- **What's new:** after an update, nb shows what changed since the version you had. Reopen it from the command palette or Settings.
- **Fresh start each session:** repos wait in reserve when nb opens. Bring back what you need, or restore the last set in one click. Turn it off in Settings → Workfolder.
- **Reserve groups:** your last session's repos, then ones used in the last 3 and 7 days, then the rest. Change the day windows in Settings → Reserve.
- **Your own groups:** right-click a repo → New group… or Move to…; rename, delete and fold them away.

## 0.2.0 — 2026-09-26
- **Themes:** Nimbus, Solstice, Aurora and Daylight, with a theme step in the welcome wizard.
- **Settings** (`Ctrl+,`): theme, code font size, diff view, workfolder, accounts, plugins and updates.
- **Plugins:** add commands, right-click entries, status items and themes from `~/.config/nb/plugins`. See the README.
- **Resizable panels:** drag the edges of the sidebar, review panel and terminal; double-click to reset.
- **Open containing folder** in the right-click menus.
- The desktop icon now shows the nb artwork instead of a blank file.

## 0.1.0 — 2026-09-26
- First release: a workfolder of repos, source control, pull requests, a real terminal, AI self-review with Claude Code, a first-run wizard and signed self-updates.
