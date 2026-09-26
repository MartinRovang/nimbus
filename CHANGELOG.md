# Changelog

Each release gets a `## <version> — <date>` section. Nimbus shows the new sections once after it updates, and `release.sh` uses the section as the GitHub release notes.

## 0.3.2 — 2026-09-26
- **What others did:** hover the people icon on a repo to see each person's latest action, like "ada pushed to feat/login (2h ago)" or "cy opened PR #12".
- **Someone pushed to your branch:** the icon turns into a warning when another person pushed to the branch you have checked out and you haven't pulled yet.
- **Background fetch:** repos in the workfolder fetch quietly every 10 minutes, so ahead/behind counts stay current. It never asks for a password.
- Click the people icon to open the repo's activity on GitHub.
- The update buttons show a download icon.

## 0.3.1 — 2026-09-26
- The people icon on a repo now says "today" only when someone else was active in the last 12 hours.

## 0.3.0 — 2026-09-26
- **nb is now Nimbus:** new name, launcher and icon. The `nimbus` command starts it, and `nb` still works. Your settings, plugins and workfolder carry over.
- **What's new:** after an update, Nimbus shows what changed since the version you had. Reopen it from the command palette or Settings.
- **Fresh start each session:** repos wait in reserve when Nimbus opens. Bring back what you need, or restore the last set in one click. Turn it off in Settings → Workfolder.
- **Reserve groups:** your last session's repos, then ones used in the last 3 and 7 days, then the rest. Change the day windows in Settings → Reserve.
- **Your own groups:** right-click a repo → New group… or Move to…; rename, delete and fold them away.
- **Updates in Settings:** Settings → About shows when a new version is out, with a button to install it.
- **Who else is here:** repos show a people icon when others pushed, opened PRs or reviewed on GitHub in the last 7 days, marked "today" when it was within a day. Hover it for names.

## 0.2.0 — 2026-09-26
- **Themes:** Nimbus, Solstice, Aurora and Daylight, with a theme step in the welcome wizard.
- **Settings** (`Ctrl+,`): theme, code font size, diff view, workfolder, accounts, plugins and updates.
- **Plugins:** add commands, right-click entries, status items and themes from `~/.config/nimbus/plugins`. See the README.
- **Resizable panels:** drag the edges of the sidebar, review panel and terminal; double-click to reset.
- **Open containing folder** in the right-click menus.
- The desktop icon now shows the Nimbus artwork instead of a blank file.

## 0.1.0 — 2026-09-26
- First release: a workfolder of repos, source control, pull requests, a real terminal, AI self-review with Claude Code, a first-run wizard and signed self-updates.
