# Changelog

Each release gets a `## <version> — <date>` section. Nimbus shows the new sections once after it updates, and the release workflow uses the section as the GitHub release notes.

## 0.3.13 — 2026-09-27
- **Under the hood:** the app's interface code is split into smaller parts, so it is easier to work on. Nothing should look or behave differently; if something does, that is a bug.
- **Safer updates:** a new version is only published after its tests pass.

## 0.3.12 — 2026-09-27
- **Faster and lighter:** repos load in parallel, and coming back to the window re-reads them at most every 5 seconds.
- **Big files stay smooth:** long files open without stalling, and very large or binary files are refused before they are read into memory.
- **Quicker start:** pull requests and issues fetch only what the tab badges need until you open their tab.
- **Smaller app:** about 4 MB of unused font files are gone from the download.

## 0.3.11 — 2026-09-27
- **Search every repo:** type in the search box in the status bar (Ctrl+Shift+F) and press Enter. Matches from all repos in the workfolder pop up above it, grouped by repo; click one to open the file at that line.
- **Commit across repos:** one message into several repos at once, optionally on a shared branch, with pull requests that link to each other. From the Changes panel or the command palette.
- **Stashes:** the Changes panel lists your stashes to apply, pop or drop, and can stash your changes. When uncommitted changes block a branch switch, Nimbus offers to stash them and switch.
- **Two branches side by side:** right-click a repo → Open another branch side by side… checks it out as its own folder (a git worktree) next to the original.
- **Issues tab** (Ctrl+4): issues from every GitHub repo in the workspace, with Open / Closed / All filters, a compact list, and a detail view with comments. Start a branch for an issue, close or reopen it.
- **Filter pull requests and issues:** a fuzzy filter box in both tabs matches titles, numbers, branches, authors and labels.
- **A terminal per repo:** the bottom panel shows the active repo's terminals, and each repo keeps its own shell history. Repos with a running terminal show a terminal icon.
- **Keyboard shortcuts:** Ctrl+/ shows them all.

## 0.3.10 — 2026-09-26
- **PR count covers the whole workspace:** the Pull requests tab badge adds up open PRs from every GitHub repo in the workspace, not just the active one.

## 0.3.9 — 2026-09-26
- **Filter pull requests:** the Pull requests panel has Open / Merged / Closed / All filters. Open (including drafts) is on by default, and your choice is remembered.

## 0.3.8 — 2026-09-26
- **New repos start collapsed:** adding, cloning or restoring a repo no longer expands its file list.
- **Compact pull requests list:** a header toggle switches the Pull requests panel to one short row per PR showing just its number (hover for the title).
- **Repo count on the Files tab:** the Files tab shows how many repos are in the workspace.

## 0.3.7 — 2026-09-26
- **Pull requests from every repo:** with several GitHub repos in the workspace, the Pull requests panel lists all their PRs, grouped by repo and sorted by name.

## 0.3.6 — 2026-09-26
- **Empty pull requests panel explains itself:** with no folders in the workspace, it tells you to add one (with a link) instead of showing nothing.

## 0.3.5 — 2026-09-26
- **Pop-outs fill a grid:** a popped-out terminal goes straight into the next free cell of a 3×2 grid (change it in Settings → Editor). Snapping now covers only the editor area, so the repo list stays visible.
- **Pop out from a repo:** with terminals already popped out, right-click a repo → Pop out a terminal here.
- **Hide popped-out terminals:** from any right-click menu or with Ctrl+Shift+`. The status bar shows how many are hidden; click it to bring them back. Their shells keep running.
- **Open PRs on the rail:** the pull requests icon shows how many PRs are open in the active repo.

## 0.3.4 — 2026-09-26
- **Terminals side by side:** each new terminal opens as a pane next to the others in the bottom panel.
- **Pop out any terminal:** drag its title bar up, or click its pop-out button, to float it over the app in its own pastel colour. Move it by the title bar, resize it from the corner, and drop it on the bottom edge to dock it again. Shells keep running throughout.
- **Snapping:** drop a popped-out terminal on an edge or corner to take a half or a quarter, or pick a 2×2, 3×2, 3×3 or 4×2 grid in Settings → Editor (or right-click a terminal). Spots held by another snapped terminal are off limits.
- Fixed: a bad reply from GitHub while checking who else worked on a repo could blank the window.

## 0.3.3 — 2026-09-26
- **Clone several at once:** the add repo or folder dialog stays open while a repo clones, so you can start more. Each row shows its own progress.

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
