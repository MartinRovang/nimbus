# nb

A minimal git IDE: one workfolder, many repos. Tauri 2 (Rust) + React.

- **Install** (no sudo): `./install.sh`. Gives you `nb` on the PATH, an app-menu entry and a desktop icon.
- **Needs**: `git`; `gh` for GitHub (the first-run wizard signs you in); `claude` (Claude Code) for AI self-review.
- **Workfolder**: chosen in the wizard (default `~/work`), stored in `~/.config/nb/workfolder`; `NB_WORKFOLDER` overrides it.
- **Self-review**: runs `claude -p --safe-mode` in the repo with read-only tools and a JSON contract; follow-up questions resume the same session. Nothing is posted unless you press *Post*.
- **Updates**: on start nb checks `github.com/MartinRovang/nimbus/releases/latest/download/latest.json`, verifies the signature and replaces itself. `./release.sh 0.2.0 "notes"` publishes one (signing key: `~/.tauri/nb.key`, keep it; losing it means installed copies can no longer update).

Dev: `npm run tauri dev` · tests: `npm test`, `cd src-tauri && cargo test` (`-- --ignored` also runs a real Claude review).
