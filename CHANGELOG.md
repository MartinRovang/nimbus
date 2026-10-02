# Changelog

Each release gets a `## <version> — <date>` section. Nimbus shows the new sections once after it updates, and the release workflow uses the section as the GitHub release notes.

## 0.3.40 — 2026-10-02
- **Experiments:** a new kind of project where Claude improves one number on its own. Pick a repo, the files it may edit, a command and how to read a metric from its output; Claude changes the code, runs it, keeps the commit when the number improves and undoes it when it doesn't. The project page charts every try. Start a project → Experiment.
- **HTML-report projects can be created again:** starting a project that reports to an HTML page failed with "not a project file".
- **Scrollbars:** the sidebar's scrollbar no longer shows over dialogs, and the thumb gets brighter while you drag it, not black.

## 0.3.39 — 2026-10-02
- **Terminal finds your tools:** the terminal starts your shell the way other terminals do, so it reads `~/.bashrc` and commands from nvm, Homebrew and the like are on PATH. Reopen a terminal to pick it up.

## 0.3.38 — 2026-10-02
- **Dialogs stay on top:** a scrollbar from the page behind no longer shows through What's new and other dialogs.

## 0.3.37 — 2026-10-02
- **Claude can bring repos in:** when Claude works in a repo that isn't in your workfolder, it can add it itself, and put repos it no longer needs in reserve. Nothing is moved or deleted: a folder from elsewhere is linked in.
- **And add them to the project:** Claude can also add a repo to the project it is working in. A git repo gets the project's own worktree, started from main, like the ones you add yourself.

## 0.3.36 — 2026-10-01
- **Selected text stands out:** text you select in the code viewer, and everywhere else, has a stronger highlight.

## 0.3.35 — 2026-10-01
- **Scrollbars you can see:** the scrollbar thumb has more contrast against the background, in every theme.

## 0.3.34 — 2026-10-01
- **Tabs on a pull request:** Overview, Files and Comments sit at the top of the PR, so you no longer scroll past the description to reach the files or what reviewers said. Clicking a file name on a comment takes you to that file.
- **One diff at a time:** clicking a file under Files shows that file's diff and closes the one that was open.

## 0.3.33 — 2026-10-01
- **See what reviewers said:** a pull request now shows each reviewer's verdict and their comments, including comments on lines. The list marks PRs with changes requested or approved.
- **Diffs in the PR:** click a file under Files changed to see what the PR changes in it, even when the branch is not checked out. Lines with comments are marked. The file button on the row still opens the file itself.

## 0.3.32 — 2026-10-01
- **Projects don't share checkouts:** each repo you add to a project now gets the project's own worktree, on a branch named after the project and made from main. Two projects on the same repos no longer get in each other's way. Deleting a project removes its worktrees; the branches stay. Projects you already have keep working as before.
- **Start Claude in any repo:** right-click any repo or worktree → Start Claude here…, and the sidebar shows whether Claude is working, waiting for you or done. Before, only projects had this.

## 0.3.31 — 2026-09-30
- **Just your PRs:** a button in the Pull requests tab switches between your own PRs and everyone's. Nimbus remembers the choice.

## 0.3.30 — 2026-09-30
- **Search works again:** the search box in the bottom bar found nothing on older git versions (before 2.38). It does now.
- **Clear search:** an x in the search box empties it and closes the results.

## 0.3.29 — 2026-09-30
- **New report look:** new projects get a report page with a progress bar, key numbers, the five phases as a pipeline you can open and close, and blockers, next steps, decisions and an activity log beside it. Claude fills in the data; the page draws it. Issue reports follow the same layout.
- **See what Claude is doing:** a repo in the sidebar shows whether the Claude in its terminal is working, waiting for you or done.
- **Other agents too:** any agent that supports MCP can set that status through the nimbus MCP server.

## 0.3.28 — 2026-09-29
- **Interactive project pages:** pages like the new PLAN tab remember what you tick and type, and Claude reads it. New projects keep their plan there: sprints, tasks to tick off and open questions to answer.
- **Diff tab:** a project's page shows what each of its repos changed against main, committed or not.
- **Pop out:** any project tab (report, plan, diff) opens in a window of its own, e.g. for the other screen.
- **Claude can drive Nimbus:** the Claude that Nimbus starts can move the project's phase, tick off the plan, open a file or tab for you and send you a message.
- **Projects in the sidebar:** a project's repos sit indented under it.
- **Lighter sky:** the animated sky behind your terminals uses far less CPU.

## 0.3.27 — 2026-09-29
- **Animated sky:** clouds now drift across the night sky behind your terminals on the other screen.
- **Background settings:** the sliders button in the terminals window turns the sky off or on and sets how see-through the terminals are (Clear, Soft or Solid).

## 0.3.26 — 2026-09-29
- **Clouds behind your terminals:** the terminals window on the other screen shows the Nimbus clouds wherever there's no terminal, and faintly through the terminals themselves.

## 0.3.25 — 2026-09-29
- **Project pages as tabs:** every HTML page Claude writes in a project folder (like a UML diagram) gets its own tab next to the report.
- **Live project page:** the report and pages refresh on their own every 10 seconds.
- **Scripts in reports:** project pages can now run their own scripts, still walled off from Nimbus.
- **UML for schema changes:** new projects ask Claude to keep a UML.html diagram whenever the work touches database structure.

## 0.3.24 — 2026-09-29
- **Selected repo stands out:** the repo or project you clicked in the workfolder is now highlighted.
- **Files open on request:** clicking a repo only selects it. Open its file tree with the caret next to its name or with Ctrl+E (⌘E).
- **PR link to Claude:** right-click a pull request and pick "Add PR link to a new Claude chat" to start Claude in that repo with the link already typed in, ready for you to add to before sending.

## 0.3.23 — 2026-09-28
- **Drop files on a terminal:** drag an image (or any file) onto a docked, popped-out or other-screen terminal and its path is typed in, quoted, ready for Claude.

## 0.3.22 — 2026-09-28
- **Screensaver removed:** the clouds no longer come up when you step away, and the setting is gone.

## 0.3.21 — 2026-09-28
- **Sprints and stacked PRs:** when a new project's goal is bigger than one pull request, Claude's plan splits it into sprints, each a shippable step with its own acceptance criteria, and uses stacked PRs where changes in a repo build on each other. It works one sprint at a time, tells you when each is done, and merges a stack from the bottom up. Small goals stay one sprint.
- **Each project has its own terminals:** terminals belong to the project that was focused when you opened them. Switching project swaps the docked, popped-out and other-screen terminals to that project's set; the others keep running out of sight until you switch back. The project bar in the sidebar has a switch button to jump straight to another project.

## 0.3.20 — 2026-09-28
- **Ask before closing:** closing Nimbus with terminals popped out or on the other screen, or with a project open, now asks first, since the shells end with it.
- **Terminals out of sight stand out:** the status bar chips for terminals on the other screen and for hidden popped-out ones are now in the accent colour, so they're hard to forget.

## 0.3.19 — 2026-09-28
- **Take the tour:** Nimbus's witch shows you around, spotlighting the workfolder, projects, changes, pull requests, search, the command palette, terminals and settings. It ends by pointing out the desktop icon, so you can open Nimbus from there (and add it to your favourites) instead of a terminal. It runs once; take it again from Settings or the command palette, and skip it any time with Esc.

## 0.3.18 — 2026-09-28
- **Merge phase with a plan:** before merging, Claude works out the merge order across the project's repos (shared code and migrations first) and how each one deploys, and agrees it with you. It then merges, waits for CI, deploys and checks one step at a time, ticking each off in the report's merge table, and stops to roll back or fix forward if a step fails.

## 0.3.17 — 2026-09-28
- **Project phases:** a project now goes Start → Development → Testing → Review → Merge. Its CLAUDE.md tells Claude what to do in each phase and when it's done, and Claude asks before moving on. The report (issue or HTML page) opens with the current phase and fills in a section per phase: the plan, branches and worktrees, test results, review feedback, what merged. The project page shows the phases; click one to move it yourself.
- **Screensaver:** after 15 minutes without mouse or keyboard, clouds drift across the screen until you move the mouse. Change the time or turn it off in Settings.

## 0.3.16 — 2026-09-28
- **Projects:** start one from the folder button in the workfolder header. Pick the repos it covers (reserve ones first), write the goal, and choose where Claude reports back: a GitHub issue or an HTML page. Nimbus makes a project folder with the repos linked inside and a CLAUDE.md telling Claude the goal and how to report what's done, what's outstanding and where it's stuck. Start Claude straight away with a first message, and add more repos later.
- **Project page and focus:** a project gets its own page with the goal, its repos and Claude's latest report. While you work in one, everything else waits in reserve; Exit brings back the repos you had out. Bring a project back from reserve any time, or delete it when you're done, closing its report issue along the way.

## 0.3.15 — 2026-09-28
- **Terminals on their own screen:** turn it on from the command palette, Settings, or a terminal's right-click menu. Every terminal moves to a separate window you can put on a second monitor, tiled and coloured by repo, while the main window keeps the repos, branches and changes. Running shells keep going when you switch either way.
- **Pick the repo for a new terminal:** in the terminals window, + or Ctrl+Shift+T asks which repo to open it in, with the active one first.

## 0.3.14 — 2026-09-27
- **Pull requests and issues stay current:** both lists refresh on their own every 10 minutes, and a refresh that fails keeps the list you had.
- **Request reviewers:** right-click an open pull request or use the button on its page, then search your repo's collaborators by name. The page shows who a review is still waiting on.

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
