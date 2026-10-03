# Nimbus

A quiet git IDE: one workfolder, many repos. Tauri 2 (Rust) + React.

**Projects** group repos around a goal: Nimbus makes a project folder with the repos linked in and a `CLAUDE.md`, and Claude works through Start → Development → Testing → Review → Merge, reporting on a GitHub issue or an HTML page. Site: <https://martinrovang.github.io/nimbus/>

**Experiments** are projects where Claude loops on one number, after [karpathy/autoresearch](https://github.com/karpathy/autoresearch): you name a repo, the files it may edit, a command and how to read a metric from its output. Claude changes the code, runs it, keeps the commit when the number improves and undoes it when it doesn't, and the project page charts every try. It may edit those files, run that command and commit or reset in that repo without asking; anything else still asks you.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/MartinRovang/nimbus/main/get.sh | sh
```

Linux x86_64, no sudo. Puts `nimbus` (and the short `nb`) in `~/.local/bin` and adds an app-menu entry and a desktop icon; Nimbus keeps itself up to date after that. Needs WebKitGTK 4.1 (`sudo apt install libwebkit2gtk-4.1-0` on Debian/Ubuntu). From a checkout: `./install.sh` builds and installs the same way.

## Notes

- **Needs**: `git`; `gh` for GitHub (the first-run wizard signs you in); `claude` (Claude Code) for AI self-review.
- **Workfolder**: chosen in the wizard (default `~/work`), stored in `~/.config/nimbus/workfolder`; `NIMBUS_WORKFOLDER` overrides it.
- **Bubblewrap** (Settings → Workfolder, off by default): new terminals, and Claude in them, open in [bubblewrap](https://github.com/containers/bubblewrap), a sandbox that sees the repos showing in Nimbus and not the rest of your computer, nor the repos in reserve. Their home is `~/.config/nimbus/sandbox` (Claude signs in there once); your tools, shell setup and Claude setup are read-only inside. No SSH keys or `gh` login in there: push from the source control panel. Extra bwrap arguments go in `~/.config/nimbus/sandbox-args`, e.g. `--ro-bind ~/.pyenv ~/.pyenv`. A repo added later is seen by terminals opened after that.
- **Self-review**: runs `claude -p --safe-mode` in the repo with read-only tools and a JSON contract; follow-up questions resume the same session. Nothing is posted unless you press *Post*.
- **Updates**: on start Nimbus checks `github.com/MartinRovang/nimbus/releases/latest/download/latest.json`, verifies the signature and replaces itself. To release, bump `VERSION`, add its section to `CHANGELOG.md` and push to `main`; the release workflow builds, signs and publishes it (skips versions already tagged). Signing key: `~/.tauri/nimbus.key`, stored as the repo secret `TAURI_SIGNING_PRIVATE_KEY`; keep it, losing it means installed copies can no longer update.

Dev: `npm run tauri dev` · tests: `npm test`, `cd src-tauri && cargo test` (`-- --ignored` also runs a real Claude review).

## Plugins

A plugin is a folder in `~/.config/nimbus/plugins/<id>/` with a `plugin.json` (`name`, `version`, `description`, `main`, default `index.js`) and an ES module exporting `activate(Nimbus)`. Settings → Plugins lists them, switches them on and off and opens the folder. [`plugins/example`](plugins/example) uses every call:

| Call | Does |
|---|---|
| `nimbus.addCommand({ label, icon?, hint?, run })` | adds a command palette entry |
| `nimbus.addMenuItem("repo" \| "file" \| "editor", { label, icon?, run({ repo, path }) })` | adds a right-click entry |
| `nimbus.addStatusItem({ text, icon?, title?, run? })` | adds status bar text; returns `{ update(fields), remove() }` |
| `nimbus.addTheme({ id, name, dark, vars })` | adds a theme (same variables as the built-in Nimbus theme in `src/themes.js`) |
| `nimbus.on("repo" \| "file" \| "commit" \| "review", fn)` | runs `fn` when that happens |
| `nimbus.state()` | `{ root, repo, file }` right now |
| `nimbus.git(repo, ...args)`, `nimbus.gh(repo, ...args)` | runs git / gh in a repo, resolves to stdout |
| `nimbus.readFile(repo, path)`, `nimbus.openFile(repo, path)` | reads / opens a file |
| `nimbus.terminal(cmd, repo?)` | opens a terminal tab and runs `cmd` |
| `nimbus.toast(text, isError?)` | shows a message |

Icons are [Phosphor](https://phosphoricons.com) class names such as `ph-rocket-launch`. Plugins run with the same access as Nimbus itself (your files, git, gh, a shell), so only install ones you trust.
