use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{Emitter, Manager};

mod mcp;
pub use mcp::{hook as mcp_hook, serve as mcp_serve};

// ponytail: every command shells out to git/gh and blocks a runtime worker; fine for one user,
// move long ones (clone, push) to spawn_blocking + progress events if the UI ever stalls.

/// ~/.config/nimbus: the workfolder choice and plugins. Before the rename to Nimbus it was ~/.config/nb.
fn config_dir() -> PathBuf {
    let base = std::env::var("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|_| home().join(".config"));
    let (new, old) = (base.join("nimbus"), base.join("nb"));
    if !new.exists() && old.exists() {
        let _ = fs::rename(&old, &new);
    }
    new
}

/// The chosen workfolder; NIMBUS_WORKFOLDER (or the older NB_WORKFOLDER) overrides it, ~/work is the default.
fn config_path() -> PathBuf {
    config_dir().join("workfolder")
}

fn root() -> PathBuf {
    std::env::var("NIMBUS_WORKFOLDER")
        .or_else(|_| std::env::var("NB_WORKFOLDER"))
        .ok()
        .or_else(|| fs::read_to_string(config_path()).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join("work"))
}

fn reserve_path() -> PathBuf {
    let (new, old) = (root().join(".nimbus-reserve"), root().join(".nb-reserve"));
    if !new.exists() && old.exists() {
        let _ = fs::rename(&old, &new);
    }
    new
}

fn reserve() -> Vec<String> {
    fs::read_to_string(reserve_path())
        .unwrap_or_default()
        .lines()
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect()
}

/// Repo ids are plain directory names inside the workfolder.
fn dir(id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.starts_with('.') || id.contains('/') || id.contains('\\') {
        return Err(format!("bad repo id: {id}"));
    }
    Ok(root().join(id))
}

fn cwd(id: Option<String>) -> Result<PathBuf, String> {
    match id {
        Some(id) => dir(&id),
        None => Ok(Some(root()).filter(|r| r.exists()).unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()))),
    }
}

fn run(cwd: &Path, prog: &str, args: &[&str]) -> Result<String, String> {
    let o = Command::new(prog)
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("{prog}: {e}"))?;
    let out = String::from_utf8_lossy(&o.stdout).into_owned();
    if o.status.success() {
        Ok(out)
    } else {
        let err = String::from_utf8_lossy(&o.stderr).trim().to_string();
        Err(if err.is_empty() { out.trim().to_string() } else { err })
    }
}

#[derive(Serialize)]
struct Branch {
    name: String,
    ahead: u32,
    behind: u32,
    remote: bool,
}

#[derive(Serialize)]
struct Change {
    path: String,
    status: String,
    staged: bool,
}

#[derive(Serialize)]
struct Commit {
    sha: String,
    msg: String,
    when: String,
}

#[derive(Serialize)]
struct Repo {
    id: String,
    remote: String,
    branch: String,
    branches: Vec<Branch>,
    changes: Vec<Change>,
    commits: Vec<Commit>,
    parked: bool,
    /// false for a plain folder: no branches, no changes, offer `git init`
    git: bool,
    /// where a linked folder really lives, "" for a repo cloned into the workfolder
    src: String,
    /// a second checkout made with `git worktree add` (its .git is a file)
    worktree: bool,
    /// `git stash list`: sha is the ref (stash@{0}), msg the description
    stashes: Vec<Commit>,
    /// a project folder made by "Start a project": its repos linked inside, a CLAUDE.md on how to report back
    project: bool,
    /// a project's repos (`repos` in its .nimbus-project.json), so the sidebar can nest them under it
    members: Vec<String>,
}

#[derive(Serialize)]
struct Workfolder {
    root: String,
    abs: String,
    exists: bool,
    repos: Vec<Repo>,
}

/// "[ahead 1, behind 2]" -> (1, 2)
fn track(s: &str) -> (u32, u32) {
    let (mut a, mut b) = (0, 0);
    for part in s.trim_matches(|c| c == '[' || c == ']').split(", ") {
        if let Some(n) = part.strip_prefix("ahead ") {
            a = n.parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix("behind ") {
            b = n.parse().unwrap_or(0);
        }
    }
    (a, b)
}

/// `git status --porcelain=v1 -z` -> one row per file.
fn parse_status(raw: &str) -> Vec<Change> {
    let mut out = vec![];
    let mut it = raw.split('\0').filter(|s| s.len() > 3);
    while let Some(e) = it.next() {
        let (x, y) = (e.as_bytes()[0] as char, e.as_bytes()[1] as char);
        if x == 'R' || x == 'C' {
            it.next(); // rename source
        }
        let staged = x != ' ' && x != '?';
        let status = if x == '?' { 'A' } else if staged { x } else { y };
        out.push(Change { path: e[3..].to_string(), status: status.to_string(), staged });
    }
    out
}

/// "git@github.com:owner/name.git" / "https://github.com/owner/name" -> "owner/name"
fn short_remote(url: &str) -> String {
    let parts: Vec<&str> = url.trim().trim_end_matches(".git").rsplit(|c| c == '/' || c == ':').take(2).collect();
    parts.into_iter().rev().collect::<Vec<_>>().join("/")
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

/// /home/me/x -> ~/x, for display
fn tilde(p: &Path) -> String {
    let (p, h) = (p.to_string_lossy(), home());
    let h = h.to_string_lossy();
    if !h.is_empty() && p.starts_with(h.as_ref()) { p.replacen(h.as_ref(), "~", 1) } else { p.into() }
}

fn members(d: &Path) -> Vec<String> {
    let cfg: Value = fs::read_to_string(d.join(PROJECT)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    cfg["repos"].as_array().into_iter().flatten().filter_map(|v| v.as_str().map(String::from)).collect()
}

fn repo_info(id: &str, parked: bool) -> Result<Repo, String> {
    let d = dir(id)?;
    let src = fs::read_link(&d).map(|t| tilde(&t)).unwrap_or_default();
    if !d.join(".git").exists() {
        let none = String::new;
        return Ok(Repo { id: id.into(), remote: none(), branch: none(), branches: vec![], changes: vec![], commits: vec![], parked, git: false, src, worktree: false, stashes: vec![], project: d.join(PROJECT).exists(), members: members(&d) });
    }
    let git = |args: &[&str]| run(&d, "git", args).unwrap_or_default();
    let mut branch = git(&["branch", "--show-current"]).trim().to_string();
    if branch.is_empty() {
        branch = git(&["rev-parse", "--short", "HEAD"]).trim().to_string();
    }
    let mut branches: Vec<Branch> = vec![];
    for line in git(&["for-each-ref", "--format=%(refname)\t%(refname:short)\t%(upstream:track)", "refs/heads", "refs/remotes"]).lines() {
        let mut f = line.split('\t');
        let (full, name, tr) = (f.next().unwrap_or(""), f.next().unwrap_or(""), f.next().unwrap_or(""));
        let remote = full.starts_with("refs/remotes/");
        if remote && (full.ends_with("/HEAD") || branches.iter().any(|b| name.split_once('/').map(|(_, n)| n) == Some(b.name.as_str()))) {
            continue;
        }
        let (ahead, behind) = track(tr);
        branches.push(Branch { name: name.into(), ahead, behind, remote });
    }
    let rows = |out: String| -> Vec<Commit> {
        out.lines()
            .filter_map(|l| {
                let mut f = l.splitn(3, '\t');
                Some(Commit { sha: f.next()?.into(), msg: f.next()?.into(), when: f.next()?.into() })
            })
            .collect()
    };
    let commits = rows(git(&["log", "-5", "--format=%h%x09%s%x09%cr"]));
    Ok(Repo {
        id: id.into(),
        remote: short_remote(&git(&["remote", "get-url", "origin"])),
        branch,
        branches,
        changes: parse_status(&git(&["status", "--porcelain=v1", "-z", "--untracked-files=all"])),
        commits,
        parked,
        git: true,
        src,
        worktree: d.join(".git").is_file(),
        stashes: rows(git(&["stash", "list", "--format=%gd%x09%gs%x09%cr"])),
        project: false,
        members: vec![],
    })
}

#[tauri::command]
async fn load() -> Result<Workfolder, String> {
    let root = root();
    let parked = reserve();
    let ids: Vec<String> = fs::read_dir(&root)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|id| !id.starts_with('.'))
        .collect();
    // each repo costs ~6 git processes; read them all at once instead of one after another
    // ponytail: one thread per repo; a pool if workfolders reach hundreds of repos
    let mut repos = std::thread::scope(|s| {
        let hs: Vec<_> = ids.iter().map(|id| s.spawn(|| repo_info(id, parked.contains(id)))).collect();
        hs.into_iter().map(|h| h.join().unwrap_or_else(|_| Err("repo read panicked".into()))).collect::<Result<Vec<_>, _>>()
    })?;
    repos.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(Workfolder { root: tilde(&root), abs: root.to_string_lossy().into(), exists: root.exists(), repos })
}

#[tauri::command]
async fn repo(id: String) -> Result<Repo, String> {
    repo_info(&id, reserve().contains(&id))
}

#[tauri::command]
async fn files(id: String) -> Result<Vec<String>, String> {
    let d = dir(&id)?;
    let mut v: Vec<String> = if d.join(".git").exists() {
        let out = run(&d, "git", &["ls-files", "-z", "--cached", "--others", "--exclude-standard"])?;
        out.split('\0').filter(|s| !s.is_empty()).map(String::from).collect()
    } else {
        let mut v = vec![];
        walk(&d, "", &mut v);
        v
    };
    v.sort();
    v.dedup();
    Ok(v)
}

/// Files of a plain folder, skipping hidden and build directories.
// ponytail: stops at 5000 files; a plain folder that big wants `git init` (and a .gitignore) anyway
fn walk(base: &Path, rel: &str, out: &mut Vec<String>) {
    for e in fs::read_dir(base.join(rel)).into_iter().flatten().flatten() {
        let n = e.file_name().to_string_lossy().into_owned();
        if out.len() >= 5000 || n.starts_with('.') || n == "node_modules" || n == "target" || n == "__pycache__" {
            continue;
        }
        let r = if rel.is_empty() { n } else { format!("{rel}/{n}") };
        // a project's linked repos are repos of their own in the workfolder, not files of the project
        if e.file_type().map(|t| t.is_symlink()).unwrap_or(false) && e.path().is_dir() {
            continue;
        }
        if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            walk(base, &r, out);
        } else {
            out.push(r);
        }
    }
}

fn file_in(id: &str, path: &str) -> Result<PathBuf, String> {
    let d = dir(id)?.canonicalize().map_err(|e| e.to_string())?;
    let p = d.join(path).canonicalize().map_err(|e| format!("{path}: {e}"))?;
    if !p.starts_with(&d) {
        return Err(format!("{path}: outside repository"));
    }
    Ok(p)
}

#[tauri::command]
async fn read_file(id: String, path: String) -> Result<String, String> {
    let p = file_in(&id, &path)?;
    // size check first: reading a multi-GB file just to say "too large" would fill memory
    if fs::metadata(&p).map_err(|e| e.to_string())?.len() > 2_000_000 {
        return Err("Binary or very large file, not shown.".into());
    }
    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    if bytes.iter().take(8000).any(|&b| b == 0) {
        return Err("Binary or very large file, not shown.".into());
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Unified diff of the working tree against HEAD; untracked files show as all-added.
#[tauri::command]
async fn diff(id: String, path: String) -> Result<String, String> {
    let d = dir(&id)?;
    let out = run(&d, "git", &["diff", "HEAD", "--", &path]).unwrap_or_default();
    if !out.is_empty() {
        return Ok(out);
    }
    // an untracked file shows as all-added; the same size limit as read_file
    let text = read_file(id, path).await?;
    let lines: Vec<&str> = text.lines().collect();
    Ok(format!("@@ -0,0 +1,{} @@\n{}", lines.len(), lines.iter().map(|l| format!("+{l}\n")).collect::<String>()))
}

#[tauri::command]
async fn git(id: Option<String>, args: Vec<String>) -> Result<String, String> {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    run(&cwd(id)?, "git", &args)
}

#[tauri::command]
async fn gh(id: Option<String>, args: Vec<String>) -> Result<String, String> {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    run(&cwd(id)?, "gh", &args)
}

/// Background `git fetch`: never asks for a password or key passphrase, it just fails and tries again later.
#[tauri::command]
async fn fetch(id: String) -> Result<(), String> {
    let mut c = Command::new("git");
    c.args(["fetch", "--quiet"]).current_dir(dir(&id)?).env("GIT_TERMINAL_PROMPT", "0").env("SSH_ASKPASS_REQUIRE", "never");
    if std::env::var_os("GIT_SSH_COMMAND").is_none() {
        c.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes");
    }
    let o = c.stdin(std::process::Stdio::null()).output().map_err(|e| e.to_string())?;
    if o.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&o.stderr).trim().into()) }
}

/// Opens a GitHub page in the browser; only github.com links, so the page can't launch anything else.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://github.com/") {
        return Err("only github.com links open from Nimbus".into());
    }
    Command::new("xdg-open").arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

// ---- terminal: one PTY per tab, output streamed to the page as raw bytes ----

struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    out: Arc<Mutex<Out>>,
}

#[derive(Default)]
struct Ptys(Mutex<HashMap<u32, Pty>>);

impl Ptys {
    fn reset(&self) {
        for (_, mut p) in self.0.lock().unwrap().drain() {
            let _ = p.child.kill();
        }
    }
}

/// Ends every shell. The main window calls it on start: after a page reload its tab ids begin at 1 again,
/// and a new terminal must not re-attach to the previous page's shell.
#[tauri::command]
fn pty_reset(ptys: tauri::State<Ptys>) {
    ptys.reset();
}

/// Output kept per shell, replayed when another window attaches (the terminals window in dual-screen mode).
// ponytail: a raw byte replay; a full-screen app (vim, claude) looks stale until it redraws. A headless
// terminal emulator per shell would restore the exact screen.
const SCROLLBACK: usize = 256 * 1024;

/// Where a shell's output goes: the attached window's channel, and always the scrollback.
#[derive(Default)]
struct Out {
    chan: Option<Channel<InvokeResponseBody>>,
    buf: VecDeque<u8>,
    done: bool,
}

impl Out {
    fn push(&mut self, bytes: &[u8]) {
        self.buf.extend(bytes);
        let over = self.buf.len().saturating_sub(SCROLLBACK);
        self.buf.drain(..over);
        if self.chan.as_ref().is_some_and(|c| c.send(InvokeResponseBody::Raw(bytes.to_vec())).is_err()) {
            self.chan = None; // that window is gone; keep buffering for the next one
        }
    }
    /// The shell ended: tell the attached window (an empty message), or the next one that attaches.
    fn finish(&mut self) {
        self.done = true;
        if let Some(c) = self.chan.take() {
            let _ = c.send(InvokeResponseBody::Raw(vec![]));
        }
    }
    /// Replays the scrollback to `chan` and sends it everything from now on.
    fn attach(&mut self, chan: Channel<InvokeResponseBody>) {
        if !self.buf.is_empty() {
            let (a, b) = self.buf.as_slices();
            let _ = chan.send(InvokeResponseBody::Raw([a, b].concat()));
        }
        if self.done {
            let _ = chan.send(InvokeResponseBody::Raw(vec![]));
        } else {
            self.chan = Some(chan);
        }
    }
}

/// Copies a shell's output into `out` until it exits.
fn pump(mut reader: Box<dyn Read + Send>, out: Arc<Mutex<Out>>) {
    let mut buf = [0u8; 16384];
    while let Ok(n) = reader.read(&mut buf) {
        if n == 0 {
            break;
        }
        out.lock().unwrap().push(&buf[..n]);
    }
    out.lock().unwrap().finish();
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }
}

/// Starts the user's shell in `dir`; returns the session and its output stream.
/// Not a login shell: like a regular terminal it reads ~/.bashrc, so PATH matches (nvm, brew, ...).
/// With `repo` set the shell keeps its own history: ~/.config/nimbus/history/<repo> for bash and zsh,
/// fish's `nimbus_<repo>` session. A shell rc that sets HISTFILE itself wins.
/// With `sandbox` the shell and all it starts (Claude) live in a bubblewrap sandbox, see sandbox_shell.
fn spawn_shell(dir: &Path, repo: Option<&str>, cols: u16, rows: u16, sandbox: bool) -> Result<(Pty, Box<dyn Read + Send>), String> {
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let mut cmd = if sandbox { sandbox_shell(dir, &shell)? } else { CommandBuilder::new(shell) };
    cmd.cwd(dir);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("NIMBUS", "1"); // tells `nimbus mcp` its Claude runs in Nimbus (see instructions in mcp.rs)
    if let Some(id) = repo {
        cmd.env("NIMBUS_REPO", id); // which sidebar row `nimbus hook` and the set_status tool mark
        let hist = config_dir().join("history");
        if fs::create_dir_all(&hist).is_ok() {
            cmd.env("HISTFILE", hist.join(id));
        }
        cmd.env("fish_history", format!("nimbus_{}", id.replace(|c: char| !c.is_ascii_alphanumeric(), "_")));
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| if sandbox { format!("The sandbox needs bubblewrap (the `bubblewrap` package): {e}") } else { e.to_string() })?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    Ok((Pty { master: pair.master, writer, child, out: Arc::default() }, reader))
}

/// Opens a shell for `tab`, or re-attaches to its running one (it moved to another window). Bytes arrive on `out`,
/// and an empty message means the shell exited. Returns true when it re-attached.
#[tauri::command]
fn pty_open(ptys: tauri::State<Ptys>, tab: u32, id: Option<String>, cols: u16, rows: u16, sandbox: bool, out: Channel<InvokeResponseBody>) -> Result<bool, String> {
    let mut map = ptys.0.lock().unwrap();
    if let Some(p) = map.get(&tab) {
        let _ = p.master.resize(size(cols, rows));
        p.out.lock().unwrap().attach(out);
        return Ok(true);
    }
    let (pty, reader) = spawn_shell(&cwd(id.clone())?, id.as_deref(), cols, rows, sandbox)?;
    pty.out.lock().unwrap().attach(out);
    let o = pty.out.clone();
    map.insert(tab, pty);
    std::thread::spawn(move || pump(reader, o));
    Ok(false)
}

#[tauri::command]
fn pty_write(ptys: tauri::State<Ptys>, tab: u32, data: String) -> Result<(), String> {
    let mut map = ptys.0.lock().unwrap();
    let p = map.get_mut(&tab).ok_or("terminal closed")?;
    p.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_resize(ptys: tauri::State<Ptys>, tab: u32, cols: u16, rows: u16) -> Result<(), String> {
    let map = ptys.0.lock().unwrap();
    let p = map.get(&tab).ok_or("terminal closed")?;
    p.master.resize(size(cols, rows)).map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_close(ptys: tauri::State<Ptys>, tab: u32) {
    if let Some(mut p) = ptys.0.lock().unwrap().remove(&tab) {
        let _ = p.child.kill();
    }
}

#[tauri::command]
async fn clone(url: String, name: String) -> Result<(), String> {
    let root = root();
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    dir(&name)?;
    run(&root, "git", &["clone", &url, &name]).map(|_| ())
}

// ---- plain folders: linked into the workfolder, never moved ----

#[derive(Serialize)]
struct LocalDir {
    name: String,
    path: String,
    abs: String,
    git: bool,
    edited: f64,
}

/// Recently touched folders in the usual places, minus the ones already in the workfolder.
#[tauri::command]
async fn local_dirs() -> Vec<LocalDir> {
    let root = root();
    let linked: Vec<PathBuf> = fs::read_dir(&root).into_iter().flatten().flatten().filter_map(|e| e.path().canonicalize().ok()).collect();
    let mut out = vec![];
    for base in ["Desktop", "projects", "code", "src", "dev", "repos", "git", "Documents"] {
        for e in fs::read_dir(home().join(base)).into_iter().flatten().flatten() {
            let (p, name) = (e.path(), e.file_name().to_string_lossy().into_owned());
            let Ok(real) = p.canonicalize() else { continue };
            if name.starts_with('.') || !real.is_dir() || real.starts_with(&root) || linked.contains(&real) {
                continue;
            }
            let edited = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as f64).unwrap_or(0.0);
            out.push(LocalDir { git: real.join(".git").exists(), path: tilde(&p), abs: p.to_string_lossy().into(), name, edited });
        }
    }
    out.sort_by(|a, b| b.edited.total_cmp(&a.edited));
    out.truncate(12);
    out
}

/// Symlinks `path` into the workfolder under its own name; returns that name.
#[tauri::command]
async fn link(path: String) -> Result<String, String> {
    let src = PathBuf::from(&path).canonicalize().map_err(|e| format!("{path}: {e}"))?;
    let name = src.file_name().map(|n| n.to_string_lossy().into_owned()).ok_or("not a folder")?;
    let dest = dir(&name)?;
    if dest.symlink_metadata().is_ok() {
        return Err(format!("{} already has a {name}", tilde(&root())));
    }
    fs::create_dir_all(root()).map_err(|e| e.to_string())?;
    std::os::unix::fs::symlink(&src, &dest).map_err(|e| e.to_string())?;
    Ok(name)
}

/// Takes a linked folder out of the workfolder; the folder itself is untouched.
#[tauri::command]
async fn unlink(id: String) -> Result<(), String> {
    let d = dir(&id)?;
    if !d.symlink_metadata().map(|m| m.file_type().is_symlink()).unwrap_or(false) {
        return Err(format!("{id} is not a linked folder"));
    }
    fs::remove_file(d).map_err(|e| e.to_string())?;
    set_parked(id, false).await
}

/// Deletes a repository from disk. A linked folder only loses its link.
#[tauri::command]
async fn remove_repo(id: String) -> Result<(), String> {
    // remove_dir_all does not follow a symlink at the top: a linked folder's real files survive
    fs::remove_dir_all(dir(&id)?).map_err(|e| e.to_string())?;
    set_parked(id, false).await
}

/// Moves every repo in the workfolder to reserve; returns the ones that were out, for "Restore last set".
#[tauri::command]
async fn park_all() -> Result<Vec<String>, String> {
    let before = reserve();
    let mut all: Vec<String> = fs::read_dir(root())
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|id| !id.starts_with('.') && dir(id).map(|d| d.is_dir()).unwrap_or(false))
        .collect();
    all.sort();
    let was_out: Vec<String> = all.iter().filter(|id| !before.contains(id)).cloned().collect();
    if !was_out.is_empty() {
        fs::write(reserve_path(), all.join("\n")).map_err(|e| e.to_string())?;
    }
    Ok(was_out)
}

/// Writes a report to ~/Downloads (or home); returns where it went.
#[tauri::command]
async fn save_md(name: String, text: String) -> Result<String, String> {
    let dl = home().join("Downloads");
    let p = if dl.is_dir() { dl } else { home() }.join(name.replace(['/', '\\'], "-"));
    fs::write(&p, text).map_err(|e| e.to_string())?;
    Ok(tilde(&p))
}

// ---- AI self-review: `claude -p` in the repo, read-only tools, JSON verdict (as in github-dashy) ----

const LENS: &str = "You are doing a self-review: the author asked you to look over their own work before they \
commit or open a pull request. Reason about structure before style.

For every change ask: where does the state live and who owns it; what breaks if this is deleted; and when does \
the timing work: ordering, async boundaries, races. Danger concentrates in the seams: between services, across \
process boundaries, at database calls, wherever two systems agree on a contract. Read the definition of a thing, \
not just the code that uses it. Before flagging a deviation, check whether it is already the established pattern \
in this codebase; an intentional oddity is not a defect. Security is structural, not a checklist. Say plainly \
what you verified first-hand. You may read files and run the git and gh commands you are allowed; change nothing.";

const CONTRACT: &str = r#"

Respond with ONLY a JSON object, no prose, no code fences:
{"summary": "<one or two plain sentences: is this ready, and what matters most>",
 "findings": [{"severity": "high" | "med" | "low", "path": "<file path relative to the repository root>", "line": <line number in the current file>,
   "title": "<max 10 words>", "detail": "<one or two sentences>", "suggestion": "<short replacement code, or empty string>"}]}
At most 8 findings, most important first. high: a real defect to fix first. med: worth fixing. low: a note.
Empty list when there is nothing to report."#;

const DISCUSS: &str = "The author has a question or an objection about your review. Answer in plain prose, \
briefly, no JSON and no markdown headings. Use your tools again if you need to check something.

They said:
";

const TOOLS: &str = "Read,Grep,Glob,Bash(git diff:*),Bash(git status:*),Bash(git log:*),Bash(git show:*),Bash(gh pr diff:*),Bash(gh pr view:*)";

#[derive(Serialize, Deserialize)]
struct Finding {
    severity: String,
    path: String,
    #[serde(default)]
    line: u32,
    title: String,
    #[serde(default)]
    detail: String,
    #[serde(default)]
    suggestion: String,
}

#[derive(Serialize)]
struct Review {
    summary: String,
    findings: Vec<Finding>,
    session: String,
}

/// Runs `claude -p` in `dir` with the prompt on stdin; returns its JSON envelope.
// ponytail: no timeout. Closing the review panel abandons the run, but the process finishes on its own.
fn claude(dir: &Path, extra: &[&str], prompt: &str) -> Result<Value, String> {
    let mut args = vec!["-p", "--output-format", "json", "--safe-mode", "--append-system-prompt", LENS, "--allowedTools", TOOLS];
    args.extend_from_slice(extra);
    let mut child = Command::new("claude")
        .args(&args)
        .current_dir(dir)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("claude: {e}. Is Claude Code installed and on PATH?"))?;
    child.stdin.take().ok_or("claude: no stdin")?.write_all(prompt.as_bytes()).map_err(|e| e.to_string())?;
    let o = child.wait_with_output().map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_slice(&o.stdout).map_err(|_| {
        let err = String::from_utf8_lossy(&o.stderr).trim().to_string();
        if err.is_empty() { "claude: output is not JSON".to_string() } else { format!("claude: {err}") }
    })?;
    if v["is_error"].as_bool().unwrap_or(false) || !o.status.success() {
        return Err(format!("claude: {}", v["result"].as_str().unwrap_or("failed")));
    }
    Ok(v)
}

/// The JSON object in a model's answer, ignoring any prose or fences around it.
fn parse_review(text: &str) -> Result<(String, Vec<Finding>), String> {
    let (a, b) = (text.find('{').ok_or("the review has no JSON")?, text.rfind('}').ok_or("the review has no JSON")?);
    let v: Value = serde_json::from_str(&text[a..=b]).map_err(|e| format!("the review is not valid JSON: {e}"))?;
    let findings = v["findings"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|f| serde_json::from_value::<Finding>(f.clone()).ok())
        .map(|mut f| {
            f.severity = match f.severity.to_lowercase().as_str() {
                "high" | "critical" | "blocking" => "high",
                "med" | "medium" => "med",
                _ => "low",
            }
            .into();
            f
        })
        .collect();
    Ok((v["summary"].as_str().unwrap_or_default().to_string(), findings))
}

/// `ask` says what to review (the changes, a file, a PR); the lens and the JSON contract are added here.
#[tauri::command]
async fn review(id: String, ask: String) -> Result<Review, String> {
    let v = claude(&dir(&id)?, &[], &format!("{ask}{CONTRACT}"))?;
    let (summary, findings) = parse_review(v["result"].as_str().unwrap_or_default())?;
    Ok(Review { summary, findings, session: v["session_id"].as_str().unwrap_or_default().into() })
}

/// A follow-up question, answered inside the session the review ran in.
#[tauri::command]
async fn review_ask(id: String, session: String, question: String) -> Result<String, String> {
    if session.is_empty() || !session.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err("no review session to ask".into());
    }
    let v = claude(&dir(&id)?, &["--resume", &session], &format!("{DISCUSS}{question}"))?;
    Ok(v["result"].as_str().unwrap_or_default().trim().to_string())
}

/// Picks the workfolder (first-run wizard) and creates it.
#[tauri::command]
async fn set_root(path: String) -> Result<(), String> {
    let path = match path.strip_prefix("~/") { Some(rest) => home().join(rest).to_string_lossy().into_owned(), None => path };
    let p = config_path();
    fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&p, &path).map_err(|e| e.to_string())?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// What the first-run wizard checks: GitHub login and the claude CLI.
#[derive(Serialize)]
struct Setup {
    gh: bool,
    user: Option<String>,
    claude: Option<String>,
    root: String,
    configured: bool,
}

#[tauri::command]
async fn setup_status() -> Setup {
    let h = home();
    let user = run(&h, "gh", &["api", "user", "--jq", ".login"]).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    Setup {
        gh: Command::new("gh").arg("--version").output().is_ok(),
        user,
        claude: run(&h, "claude", &["--version"]).ok().map(|s| s.trim().to_string()),
        root: tilde(&root()),
        configured: config_path().exists() || std::env::var("NIMBUS_WORKFOLDER").is_ok() || std::env::var("NB_WORKFOLDER").is_ok(),
    }
}

/// GitHub device login through `gh`: the one-time code goes out on `code`, the browser opens on
/// github.com/login/device, and this returns the login once the person approves it there.
#[tauri::command]
async fn gh_login(code: Channel<String>) -> Result<String, String> {
    use std::io::{BufRead, BufReader};
    let mut child = Command::new("gh")
        .args(["auth", "login", "--web", "--hostname", "github.com", "--git-protocol", "https"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("gh: {e}. Install the GitHub CLI first."))?;
    let mut said = String::new();
    for line in BufReader::new(child.stderr.take().ok_or("gh: no output")?).lines().map_while(Result::ok) {
        if let Some(c) = line.split("one-time code: ").nth(1) {
            let _ = code.send(c.trim().to_string());
            let _ = Command::new("xdg-open").arg("https://github.com/login/device").spawn();
        }
        said.push_str(&line);
        said.push('\n');
    }
    if !child.wait().map_err(|e| e.to_string())?.success() {
        return Err(said.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("gh auth login failed").to_string());
    }
    let _ = run(&home(), "gh", &["auth", "setup-git"]);
    run(&home(), "gh", &["api", "user", "--jq", ".login"]).map(|s| s.trim().to_string())
}

/// After an update wrote the new binary over the old path: start it and quit this one.
#[tauri::command]
fn restart(app: tauri::AppHandle, exe: tauri::State<Exe>) -> Result<(), String> {
    use std::os::unix::process::CommandExt;
    Command::new(&exe.0).env("NIMBUS_FOREGROUND", "1").process_group(0).spawn().map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

/// Where this binary was started from, read before an update can move it.
struct Exe(PathBuf);

// ---- plugins: ~/.config/nimbus/plugins/<id>/plugin.json + an ES module the page imports ----

fn plugins_dir() -> PathBuf {
    config_dir().join("plugins")
}

#[derive(Serialize)]
struct Plugin {
    id: String,
    name: String,
    version: String,
    description: String,
    source: String,
    error: String,
}

/// Every plugin folder with its manifest and code; a broken one comes back with `error` set.
#[tauri::command]
async fn plugins() -> Vec<Plugin> {
    let mut out: Vec<Plugin> = fs::read_dir(plugins_dir())
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_dir() && !e.file_name().to_string_lossy().starts_with('.'))
        .map(|e| {
            let id = e.file_name().to_string_lossy().into_owned();
            let m: Value = fs::read_to_string(e.path().join("plugin.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
            let field = |k: &str| m[k].as_str().unwrap_or_default().to_string();
            let main = m["main"].as_str().unwrap_or("index.js");
            let (source, error) = if m.is_null() {
                (String::new(), "plugin.json is missing or not valid JSON".to_string())
            } else if main.contains("..") || main.starts_with('/') {
                (String::new(), format!("main {main:?} must stay inside the plugin folder"))
            } else {
                match fs::read_to_string(e.path().join(main)) {
                    Ok(s) => (s, String::new()),
                    Err(err) => (String::new(), format!("{main}: {err}")),
                }
            };
            Plugin { name: Some(field("name")).filter(|n| !n.is_empty()).unwrap_or_else(|| id.clone()), version: field("version"), description: field("description"), id, source, error }
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

/// Opens the plugins folder in the file manager (creating it first); returns its path.
#[tauri::command]
async fn open_plugins_dir() -> Result<String, String> {
    let d = plugins_dir();
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Command::new("xdg-open").arg(&d).spawn().map_err(|e| e.to_string())?;
    Ok(tilde(&d))
}

/// Shows a file (or the repo, when `path` is empty) in the file manager, selected where supported.
#[tauri::command]
async fn reveal(id: String, path: String) -> Result<(), String> {
    let p = if path.is_empty() { dir(&id)? } else { file_in(&id, &path)? };
    let uri = format!("file://{}", p.to_string_lossy().replace('%', "%25").replace(' ', "%20").replace('#', "%23"));
    // FileManager1 is what Nautilus, Dolphin and Nemo answer to; it opens the folder with the file highlighted
    let shown = Command::new("dbus-send")
        .args(["--session", "--print-reply", "--dest=org.freedesktop.FileManager1", "/org/freedesktop/FileManager1", "org.freedesktop.FileManager1.ShowItems", &format!("array:string:{uri}"), "string:"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !shown {
        let folder = if p.is_dir() { p.clone() } else { p.parent().map(Path::to_path_buf).unwrap_or(p.clone()) };
        Command::new("xdg-open").arg(folder).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) const PROJECT: &str = ".nimbus-project.json";

/// What Nimbus may write into a project folder: the files it generates itself. Anything else is refused.
const PROJECT_FILES: [&str; 7] = ["CLAUDE.md", PROJECT, "REPORT.html", "REPORT.json", "run.sh", "results.tsv", ".claude/settings.json"];

fn write_project_files(d: &Path, files: &HashMap<String, String>) -> Result<(), String> {
    for (f, text) in files {
        if !PROJECT_FILES.contains(&f.as_str()) {
            return Err(format!("not a project file: {f}"));
        }
        let p = d.join(f);
        if let Some(up) = p.parent() {
            fs::create_dir_all(up).map_err(|e| e.to_string())?;
        }
        fs::write(&p, text).map_err(|e| e.to_string())?;
        if f == "run.sh" {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&p, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Creates or updates project folder `name` in the workfolder: links each of `repos` inside it (../repo), writes
/// `files` (see PROJECT_FILES: CLAUDE.md, the .nimbus-project.json it is recognised by, …) and takes the project and its repos out of reserve.
#[tauri::command]
async fn save_project(name: String, repos: Vec<String>, files: HashMap<String, String>) -> Result<(), String> {
    let d = dir(&name)?;
    if d.exists() && !d.join(PROJECT).exists() {
        return Err(format!("{} already has a {name}", tilde(&root())));
    }
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    for id in &repos {
        // a project's own worktree demo@proj is linked as proj/demo
        let link = d.join(id.split('@').next().unwrap_or(id));
        if !dir(id)?.is_dir() {
            return Err(format!("no repo {id} in the workfolder"));
        }
        if link.symlink_metadata().is_err() {
            std::os::unix::fs::symlink(Path::new("..").join(id), &link).map_err(|e| e.to_string())?;
        }
    }
    write_project_files(&d, &files)?;
    let list: Vec<String> = reserve().into_iter().filter(|x| *x != name && !repos.contains(x)).collect();
    fs::write(reserve_path(), list.join("\n")).map_err(|e| e.to_string())
}

/// Keeps what an interactive project page saves (`nimbus.save(data)`) as <page>.json next to it, where Claude reads it.
/// Page scripts are Claude's, so this is all they can write: their own .json, in a project.
#[tauri::command]
async fn save_page_data(id: String, page: String, json: String) -> Result<(), String> {
    write_page_data(&dir(&id)?, &page, Some(&json))
}

/// Checks `page` is a page of project folder `d`, then writes `json` (if any) to its .json; the MCP tools use it too.
pub(crate) fn write_page_data(d: &Path, page: &str, json: Option<&str>) -> Result<(), String> {
    let stem = page.strip_suffix(".html").or_else(|| page.strip_suffix(".htm"))
        .filter(|s| !s.is_empty() && !s.starts_with('.') && !s.contains(['/', '\\']))
        .ok_or("not a project page")?;
    if !d.join(PROJECT).exists() || !d.join(&page).is_file() {
        return Err("not a project page".into());
    }
    let Some(json) = json else { return Ok(()) };
    if json.len() > 1_000_000 {
        return Err("page data over 1 MB".into());
    }
    serde_json::from_str::<Value>(json).map_err(|e| e.to_string())?;
    fs::write(d.join(format!("{stem}.json")), json).map_err(|e| e.to_string())
}

/// The binary Claude starts as `nimbus mcp` (this one: the dev build in dev).
#[tauri::command]
fn mcp_exe(exe: tauri::State<Exe>) -> String {
    exe.0.to_string_lossy().into_owned()
}

/// Adds `nimbus mcp` to the user's own Claude config, so a `claude` typed by hand has the tools too.
#[tauri::command]
fn mcp_install(exe: tauri::State<Exe>) -> Result<(), String> {
    let _ = run(&home(), "claude", &["mcp", "remove", "--scope", "user", "nimbus"]); // add refuses a name that is taken
    run(&home(), "claude", &["mcp", "add", "--scope", "user", "nimbus", "--", &exe.0.to_string_lossy(), "mcp"]).map(|_| ())
}

/// The workfolder's repos a sandbox opens: the ones showing in Nimbus, not those in reserve. (name, where it really is)
fn sandbox_repos(root: &Path, parked: &[String]) -> Vec<(String, PathBuf)> {
    let mut v: Vec<_> = fs::read_dir(root).into_iter().flatten().flatten()
        .map(|e| (e.file_name().to_string_lossy().into_owned(), e.path()))
        .filter(|(n, _)| !n.starts_with('.') && !parked.contains(n))
        .filter_map(|(n, p)| Some((n, p.canonicalize().ok().filter(|p| p.is_dir())?)))
        .collect();
    v.sort();
    v
}

/// The bwrap arguments of a sandboxed terminal (see sandbox_shell): a filesystem holding the system (read-only), the repos showing in Nimbus,
/// and `sb` as the home folder. The workfolder itself is an empty folder made for each run, with those repos in it (a
/// linked one at its real path too): what a sandboxed Claude puts or links at its top level is gone afterwards, and
/// the repos in reserve are not there at all. A repo taken out of reserve shows up in the next sandbox.
fn sandbox_args(home: &Path, root: &Path, parked: &[String], sb: &Path, exe: &Path, sock: &Path, extra: &str) -> Vec<String> {
    let s = |p: &Path| p.to_string_lossy().into_owned();
    let mut a: Vec<String> = ["--unshare-all", "--share-net", "--die-with-parent", "--ro-bind", "/usr", "/usr", "--ro-bind", "/etc", "/etc", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp"].map(String::from).into();
    for d in ["/bin", "/sbin", "/lib", "/lib32", "/lib64", "/opt", "/run/systemd/resolve"] { // the last one: where /etc/resolv.conf points
        a.extend(["--ro-bind-try".into(), d.into(), d.into()]);
    }
    a.extend(["--bind".into(), s(sb), s(home)]);
    // your tools, your shell's setup (PATH) and your Claude setup, read-only: a sandboxed Claude that could write a hook or a plugin there would run it outside later
    for d in [".local/bin", ".local/share/claude", ".cargo/bin", ".rustup", ".nvm", ".bun", ".npm-global", ".gitconfig", ".bashrc", ".profile", ".zshrc", ".zshenv", ".config/fish", ".claude/CLAUDE.md", ".claude/settings.json", ".claude/skills", ".claude/plugins", ".claude/agents", ".claude/commands"] {
        a.extend(["--ro-bind-try".into(), s(&home.join(d)), s(&home.join(d))]);
    }
    a.extend(["--tmpfs".into(), s(root), "--ro-bind-try".into(), s(&root.join(".nimbus-reserve")), s(&root.join(".nimbus-reserve"))]);
    for (name, real) in sandbox_repos(root, parked) {
        a.extend(["--bind".into(), s(&real), s(&real)]);
        if real != root.join(&name) {
            a.extend(["--symlink".into(), s(&real), s(&root.join(&name))]);
        }
        // a worktree (demo@project) commits into its repo's .git, which may be in reserve: "gitdir: /w/demo/.git/worktrees/x"
        let git = fs::read_to_string(real.join(".git")).ok().and_then(|t| Path::new(t.trim().strip_prefix("gitdir: ")?).ancestors().find(|p| p.ends_with(".git")).map(s));
        if let Some(g) = git {
            a.extend(["--bind-try".into(), g.clone(), g]);
        }
    }
    a.extend(["--ro-bind".into(), s(exe), s(exe), "--bind-try".into(), s(sock), s(sock)]); // `nimbus mcp` and `nimbus hook` still reach the app
    a.extend(["--setenv".into(), "NIMBUS_WORKFOLDER".into(), s(root), "--setenv".into(), "DISABLE_AUTOUPDATER".into(), "1".into()]); // the workfolder choice is in the real home; Claude's own files are read-only
    // ponytail: split on whitespace, so no paths with spaces in sandbox-args; parse quotes if someone needs one
    a.extend(extra.split_whitespace().map(|w| w.replacen('~', &s(home), usize::from(w.starts_with("~/")))));
    a
}

/// The sandbox home's first ~/.claude.json: yours (theme, onboarding done, what you dismissed), so Claude does not start
/// from zero there, without what tells of the rest of the computer: MCP servers and the projects that are not in this sandbox.
/// Signing in is not carried over: sharing the token file would let a refresh in one place sign the other out.
fn sandbox_claude_json(mut mine: Value, root: &Path, parked: &[String]) -> Value {
    let repos = sandbox_repos(root, parked);
    let inside = |p: &str| Path::new(p).canonicalize().is_ok_and(|p| repos.iter().any(|(_, d)| p.starts_with(d)));
    if let Some(o) = mine.as_object_mut() {
        o.retain(|k, _| k != "mcpServers" && k != "githubRepoPaths");
        if let Some(ps) = o.get_mut("projects").and_then(Value::as_object_mut) {
            ps.retain(|k, _| inside(k));
        }
    }
    mine
}

/// The user's shell in `dir` inside a bubblewrap sandbox that sees the repos showing in Nimbus and not the rest of the
/// computer. Its home is ~/.config/nimbus/sandbox, kept between runs: Claude signs in there once, and its history and
/// the caches of cargo, npm etc. stay apart from yours. More bwrap arguments (e.g. `--ro-bind ~/.pyenv ~/.pyenv`) go in
/// ~/.config/nimbus/sandbox-args.
fn sandbox_shell(dir: &Path, shell: &str) -> Result<CommandBuilder, String> {
    let sb = config_dir().join("sandbox");
    fs::create_dir_all(&sb).map_err(|e| format!("{}: {e}", sb.display()))?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let read = |p: PathBuf| fs::read_to_string(p).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
    if read(sb.join(".claude.json")).is_none_or(|v| v["hasCompletedOnboarding"] != true) {
        if let Some(mine) = read(home().join(".claude.json")) {
            let _ = fs::write(sb.join(".claude.json"), sandbox_claude_json(mine, &root(), &reserve()).to_string());
        }
    }
    let mut c = CommandBuilder::new("bwrap");
    c.args(sandbox_args(&home(), &root(), &reserve(), &sb, &exe, &mcp::socket_path(), &fs::read_to_string(config_dir().join("sandbox-args")).unwrap_or_default()));
    // where a sandboxed program can still type into a terminal it shares with the outside (TIOCSTI, off on current kernels), cut it loose
    if fs::read_to_string("/proc/sys/dev/tty/legacy_tiocsti").map(|v| v.trim() != "0").unwrap_or(true) {
        c.arg("--new-session");
    }
    c.args(["--chdir", &dir.to_string_lossy(), "--", shell]);
    Ok(c)
}

/// Opens a project's REPORT.html (the one Claude keeps up to date) in the browser.
#[tauri::command]
async fn open_report(id: String) -> Result<(), String> {
    let p = dir(&id)?.join("REPORT.html");
    if !p.exists() {
        return Err("No REPORT.html yet: Claude writes it after its first piece of work".into());
    }
    Command::new("xdg-open").arg(p).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn make_root() -> Result<(), String> {
    fs::create_dir_all(root()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_parked(id: String, parked: bool) -> Result<(), String> {
    let mut list: Vec<String> = reserve().into_iter().filter(|x| *x != id).collect();
    if parked {
        list.push(id);
    }
    fs::write(reserve_path(), list.join("\n")).map_err(|e| e.to_string())
}

/// Before the rename to Nimbus the app ran as ~/.local/bin/nb with an "nb" launcher. The first run of a
/// renamed build moves such an install to the new names once; `nb` stays as an alias. Returns whether it did.
fn migrate_install(home: &Path, exe: &Path, desktop: &Path) -> bool {
    let bin = home.join(".local/bin");
    let (old, new) = (bin.join("nb"), bin.join("nimbus"));
    let is_file = old.symlink_metadata().map(|m| m.file_type().is_file()).unwrap_or(false);
    if exe != old || !is_file || new.exists() || fs::rename(&old, &new).is_err() {
        return false;
    }
    let _ = std::os::unix::fs::symlink("nimbus", &old);
    let (apps, icons) = (home.join(".local/share/applications"), home.join(".local/share/icons/hicolor/512x512/apps"));
    let _ = fs::rename(icons.join("nb.png"), icons.join("nimbus.png"));
    let entry = format!(
        "[Desktop Entry]\nType=Application\nName=Nimbus\nComment=A quiet git IDE\nExec={}\nIcon={}\nTerminal=false\nCategories=Development;IDE;\nStartupWMClass=com.martin.nb\n",
        new.display(),
        icons.join("nimbus.png").display()
    );
    let _ = fs::create_dir_all(&apps).and_then(|_| fs::write(apps.join("nimbus.desktop"), &entry));
    let _ = fs::remove_file(apps.join("nb.desktop"));
    if fs::remove_file(desktop.join("nb.desktop")).is_ok() {
        use std::os::unix::fs::PermissionsExt;
        let launcher = desktop.join("nimbus.desktop");
        if fs::write(&launcher, &entry).is_ok() {
            let _ = fs::set_permissions(&launcher, fs::Permissions::from_mode(0o755));
            let _ = Command::new("gio").args(["set", &launcher.to_string_lossy(), "metadata::trusted", "true"]).output();
        }
    }
    true
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run_app() {
    if let Ok(exe) = std::env::current_exe() {
        let desktop = run(&home(), "xdg-user-dir", &["DESKTOP"]).map(|s| PathBuf::from(s.trim())).unwrap_or_else(|_| home().join("Desktop"));
        migrate_install(&home(), &exe, &desktop);
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Exe(std::env::current_exe().unwrap_or_default()))
        .manage(Ptys::default())
        .setup(|app| {
            // what `nimbus mcp` asks of the running app goes to the main window as an nb-mcp event
            let h = app.handle().clone();
            mcp::listen(move |m| h.emit_to("main", "nb-mcp", m).map_err(|e| e.to_string()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load, repo, files, read_file, diff, git, gh, clone, make_root, set_parked, park_all, local_dirs, link, unlink, remove_repo, save_md, review, review_ask, set_root, setup_status, gh_login, restart, plugins, open_plugins_dir, reveal, fetch, open_url, pty_open, pty_write, pty_resize, pty_close, pty_reset, save_project, save_page_data, open_report, mcp_exe, mcp_install
        ])
        // the terminals window (dual-screen mode) can't work without the main one: quit with it
        .on_window_event(|w, e| {
            if w.label() == "main" && matches!(e, tauri::WindowEvent::Destroyed) {
                w.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sandbox_opens_the_repos_showing_only() {
        let t = std::env::temp_dir().join(format!("nimbus-sb-{}", std::process::id()));
        let (root, away) = (t.join("home/work"), t.join("home/elsewhere/linked"));
        for d in [root.join("repo/.git/worktrees/x"), root.join("parked"), root.join("repo@proj"), away.clone()] {
            fs::create_dir_all(d).unwrap();
        }
        fs::write(root.join(".nimbus-reserve"), "parked\nrepo\n").unwrap();
        std::os::unix::fs::symlink(&away, root.join("linked")).unwrap();
        let (root, away) = (root.canonicalize().unwrap(), away.canonicalize().unwrap());
        fs::write(root.join("repo@proj/.git"), format!("gitdir: {}/repo/.git/worktrees/x\n", root.display())).unwrap();
        let parked = ["parked".to_string(), "repo".to_string()];
        let a = sandbox_args(&t.join("home"), &root, &parked, &t.join("sb"), Path::new("/x/nimbus"), Path::new("/run/n.sock"), "--ro-bind ~/.pyenv ~/.pyenv");
        let at = |w: &[&str]| a.windows(w.len()).position(|x| x == w);
        let (r, aw) = (root.to_str().unwrap(), away.to_str().unwrap());
        let (tree, git, link) = (format!("{r}/repo@proj"), format!("{r}/repo/.git"), format!("{r}/linked"));
        let (home, top) = (at(&["--bind", t.join("sb").to_str().unwrap(), t.join("home").to_str().unwrap()]).unwrap(), at(&["--tmpfs", r]).unwrap());
        assert!(home < top && top < at(&["--bind", &tree, &tree]).unwrap(), "the home, then an empty workfolder, then each repo showing");
        assert!(at(&["--bind", aw, aw]).is_some() && at(&["--symlink", aw, &link]).is_some(), "a linked repo is opened where it really is, and linked again");
        assert!(at(&["--bind-try", &git, &git]).is_some(), "a worktree gets its repo's .git, also when that repo is in reserve");
        assert!(!a.iter().any(|x| x.ends_with("/elsewhere") || x.ends_with("/parked") || x.ends_with("/repo")), "not the folder beside a linked repo, and not the repos in reserve");
        assert!(at(&["--ro-bind", "~/.pyenv", "~/.pyenv"]).is_none() && a.ends_with(&[t.join("home/.pyenv").to_str().unwrap().to_string()]), "sandbox-args, with ~ as the real home");
        let j = sandbox_claude_json(serde_json::json!({"theme": "dark", "mcpServers": {"x": 1}, "githubRepoPaths": {}, "projects": {r: 1, &tree: 2, aw: 3, format!("{r}/parked"): 4, "/gone": 5}}), &root, &parked);
        assert_eq!(j, serde_json::json!({"theme": "dark", "projects": {&tree: 2, aw: 3}}), "your Claude state without what is not in the sandbox");
        fs::remove_dir_all(t).unwrap();
    }

    #[test]
    fn parses_git_output() {
        assert_eq!(track("[ahead 1, behind 2]"), (1, 2));
        assert_eq!(track("[behind 4]"), (0, 4));
        assert_eq!(track(""), (0, 0));
        let c = parse_status("M  a.rs\0 M b.rs\0?? new.txt\0R  new.rs\0old.rs\0");
        let got: Vec<_> = c.iter().map(|c| (c.path.as_str(), c.status.as_str(), c.staged)).collect();
        assert_eq!(got, [("a.rs", "M", true), ("b.rs", "M", false), ("new.txt", "A", false), ("new.rs", "R", true)]);
        assert_eq!(short_remote("git@github.com:mara-k/nimbus-api.git\n"), "mara-k/nimbus-api");
        assert_eq!(short_remote("https://github.com/mara-k/dotfiles"), "mara-k/dotfiles");
        let (sum, f) = parse_review("Sure:\n```json\n{\"summary\":\"ok\",\"findings\":[{\"severity\":\"Medium\",\"path\":\"a.rs\",\"line\":3,\"title\":\"t\"},{\"bad\":1}]}\n```").unwrap();
        assert_eq!((sum.as_str(), f.len(), f[0].severity.as_str(), f[0].detail.as_str()), ("ok", 1, "med", ""));
        assert!(parse_review("no json here").is_err());
        assert!(dir("../etc").is_err() && dir(".git").is_err() && dir("ok").is_ok());
    }

    #[test]
    fn commands_against_real_repo() {
        let root = std::env::temp_dir().join(format!("nimbus-test-{}", std::process::id()));
        let repo = root.join("demo");
        fs::create_dir_all(&repo).unwrap();
        std::env::set_var("NIMBUS_WORKFOLDER", &root);
        std::env::set_var("XDG_CONFIG_HOME", root.join(".config"));
        let g = |args: &[&str]| run(&repo, "git", args).unwrap();
        g(&["init", "-q", "-b", "main"]);
        fs::write(repo.join("a.txt"), "one\ntwo\n").unwrap();
        g(&["add", "."]);
        g(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first"]);
        fs::write(repo.join("a.txt"), "one\nTWO\n").unwrap();
        fs::write(repo.join("new.txt"), "hi\n").unwrap();

        use tauri::async_runtime::block_on as block;
        let wf = block(load()).unwrap();
        let r = &wf.repos[0];
        assert_eq!((r.id.as_str(), r.branch.as_str(), r.commits[0].msg.as_str()), ("demo", "main", "first"));
        let ch: Vec<_> = r.changes.iter().map(|c| (c.path.as_str(), c.status.as_str())).collect();
        assert_eq!(ch, [("a.txt", "M"), ("new.txt", "A")]);
        assert!(block(diff("demo".into(), "a.txt".into())).unwrap().contains("-two\n+TWO"));
        assert_eq!(block(diff("demo".into(), "new.txt".into())).unwrap(), "@@ -0,0 +1,1 @@\n+hi\n");
        assert!(block(read_file("demo".into(), "../../etc/passwd".into())).is_err());
        let plain = std::env::temp_dir().join(format!("nimbus-plain-{}", std::process::id()));
        fs::create_dir_all(plain.join("sub")).unwrap();
        fs::write(plain.join("sub/x.py"), "print(1)\n").unwrap();
        let name = block(link(plain.to_string_lossy().into())).unwrap();
        let wf = block(load()).unwrap();
        let p = wf.repos.iter().find(|r| r.id == name).unwrap();
        assert!(!p.git && p.src.contains("nimbus-plain-"));
        assert_eq!(block(files(name.clone())).unwrap(), ["sub/x.py"]);
        block(unlink(name.clone())).unwrap();
        assert!(plain.join("sub/x.py").exists(), "unlink must leave the real folder alone");
        fs::remove_dir_all(&plain).unwrap();
        let cfg = root.join(".config");
        fs::create_dir_all(cfg.join("nb/plugins")).unwrap();
        assert!(plugins_dir().ends_with("nimbus/plugins") && cfg.join("nimbus/plugins").exists() && !cfg.join("nb").exists(), "old ~/.config/nb moves to nimbus");
        let pd = plugins_dir();
        let _ = fs::remove_dir_all(&pd);
        fs::create_dir_all(pd.join("good")).unwrap();
        fs::create_dir_all(pd.join("broken")).unwrap();
        fs::create_dir_all(pd.join("sneaky")).unwrap();
        fs::write(pd.join("good/plugin.json"), r#"{"name":"Good","version":"1.0.0"}"#).unwrap();
        fs::write(pd.join("good/index.js"), "export function activate(nimbus) {}").unwrap();
        fs::write(pd.join("broken/plugin.json"), "{nope").unwrap();
        fs::write(pd.join("sneaky/plugin.json"), r#"{"main":"../../../etc/passwd"}"#).unwrap();
        let ps = block(plugins());
        let got: Vec<_> = ps.iter().map(|p| (p.id.as_str(), p.name.as_str(), p.error.is_empty(), p.source.is_empty())).collect();
        assert_eq!(got, [("broken", "broken", false, true), ("good", "Good", true, false), ("sneaky", "sneaky", false, true)]);
        fs::remove_dir_all(&pd).unwrap();
        assert_eq!(block(park_all()).unwrap(), ["demo"]);
        assert!(block(park_all()).unwrap().is_empty(), "nothing left out the second time");
        assert!(block(load()).unwrap().repos[0].parked);
        let pf = HashMap::from([("CLAUDE.md".to_string(), "# p".to_string()), (PROJECT.to_string(), r#"{"repos":["demo"]}"#.to_string())]);
        block(save_project("proj".into(), vec!["demo".into()], pf.clone())).unwrap();
        let wf = block(load()).unwrap();
        let (d, p) = (&wf.repos[0], &wf.repos[1]);
        assert!(p.project && !p.parked && !d.parked, "project and its repos come out of reserve");
        assert!(p.members == ["demo"] && d.members.is_empty(), "a project lists its repos");
        assert!(root.join("proj/demo/a.txt").exists());
        assert_eq!(block(files("proj".into())).unwrap(), ["CLAUDE.md"], "linked repos are not project files");
        assert!(block(save_project("demo".into(), vec![], pf.clone())).is_err(), "never writes into a repo");
        assert!(block(save_project("proj".into(), vec![], HashMap::from([("../x".to_string(), String::new())]))).is_err());
        fs::write(root.join("proj/PLAN.html"), "<p>").unwrap();
        block(save_page_data("proj".into(), "PLAN.html".into(), r#"{"done":[1]}"#.into())).unwrap();
        assert_eq!(fs::read_to_string(root.join("proj/PLAN.json")).unwrap(), r#"{"done":[1]}"#);
        for (id, page, json) in [("proj", "PLAN.html", "{nope"), ("proj", "NONE.html", "{}"), ("proj", "demo/a.txt", "{}"), ("proj", ".nimbus-project.html", "{}"), ("demo", "PLAN.html", "{}")] {
            assert!(block(save_page_data(id.into(), page.into(), json.into())).is_err(), "{id} {page} {json}");
        }
        assert_eq!(fs::read_to_string(root.join("proj").join(PROJECT)).unwrap(), r#"{"repos":["demo"]}"#, "a page can't touch the project file");
        fs::create_dir_all(root.join("demo@proj")).unwrap();
        block(save_project("proj".into(), vec!["demo@proj".into()], HashMap::new())).unwrap();
        assert!(root.join("proj/demo/a.txt").exists(), "an existing link is kept");
        fs::remove_file(root.join("proj/demo")).unwrap();
        block(save_project("proj".into(), vec!["demo@proj".into()], HashMap::new())).unwrap();
        assert_eq!(fs::read_link(root.join("proj/demo")).unwrap(), Path::new("../demo@proj"), "a worktree is linked under its repo's name");
        fs::remove_dir_all(root.join("demo@proj")).unwrap();

        // the MCP workfolder tools: link a folder in, park it, bring it back, add to the project
        let out = std::env::temp_dir().join(format!("nimbus-test-out-{}", std::process::id()));
        let (api, proj) = (out.join("api"), root.join("proj"));
        fs::create_dir_all(out.join("notes")).unwrap();
        fs::create_dir_all(&api).unwrap();
        run(&api, "git", &["init", "-q", "-b", "main"]).unwrap();
        run(&api, "git", &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first", "--allow-empty"]).unwrap();
        run(&api, "git", &["checkout", "-q", "-b", "side"]).unwrap();
        run(&api, "git", &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "off main", "--allow-empty"]).unwrap();
        fs::write(proj.join("CLAUDE.md"), "<!-- nimbus:repos -->\n- `demo/`\n<!-- /nimbus:repos -->").unwrap();
        let tool = |name: &str, args: Value| mcp::call(&proj, &root.join("no.sock"), name, &args);
        let notes = out.join("notes").to_string_lossy().into_owned();
        assert!(tool("add_repo", serde_json::json!({"repo": out.join("nope")})).is_err());
        assert!(tool("add_repo", serde_json::json!({"repo": "nope"})).is_err());
        tool("add_repo", serde_json::json!({"repo": notes})).unwrap();
        assert_eq!(fs::read_link(root.join("notes")).unwrap(), out.join("notes").canonicalize().unwrap());
        tool("add_repo", serde_json::json!({"repo": notes})).expect("adding it again is fine");
        tool("park_repo", serde_json::json!({"repo": "notes"})).unwrap();
        assert!(tool("park_repo", serde_json::json!({"repo": "../etc"})).is_err());
        let wf: Value = serde_json::from_str(&tool("workfolder_repos", Value::Null).unwrap()).unwrap();
        assert!(wf["parked"] == serde_json::json!(["notes"]) && wf["in"].as_array().unwrap().contains(&"demo".into()), "{wf}");
        tool("add_repo", serde_json::json!({"repo": "notes", "project": true})).unwrap();
        tool("add_repo", serde_json::json!({"repo": api, "project": true})).unwrap();
        assert!(tool("add_repo", serde_json::json!({"repo": "api", "project": true})).is_err(), "already in the project");
        assert!(reserve().is_empty(), "added repos come out of reserve");
        assert_eq!(fs::read_link(proj.join("api")).unwrap(), Path::new("../api@proj"), "a git repo gets the project's worktree");
        assert_eq!(run(&root.join("api@proj"), "git", &["branch", "--show-current"]).unwrap().trim(), "proj");
        assert_eq!(run(&root.join("api@proj"), "git", &["log", "-1", "--format=%s"]).unwrap().trim(), "first", "from main, not the branch that is checked out");
        assert_eq!(fs::read_link(proj.join("notes")).unwrap(), Path::new("../notes"), "a plain folder is linked as it is");
        assert_eq!(members(&proj), ["demo", "notes", "api@proj"]);
        assert!(fs::read_to_string(proj.join("CLAUDE.md")).unwrap().contains("- `demo/`\n- `notes/`\n- `api/`\n<!-- /nimbus"));
        fs::remove_dir_all(&out).unwrap();

        block(remove_repo("proj".into())).unwrap();
        assert!(!root.join("proj").exists() && root.join("demo/a.txt").exists(), "deleting a project leaves its repos alone");
        fs::remove_dir_all(&root).unwrap();
    }

    /// Needs bubblewrap, and writes the sandbox's home under a temporary XDG_CONFIG_HOME.
    #[test]
    #[ignore]
    fn sandboxed_shell_sees_no_home() {
        let t = std::env::temp_dir().join(format!("nimbus-sbsh-{}", std::process::id()));
        fs::create_dir_all(t.join("work/repo")).unwrap();
        std::env::set_var("XDG_CONFIG_HOME", t.join("cfg"));
        std::env::set_var("NIMBUS_WORKFOLDER", t.join("work"));
        let (mut p, mut reader) = spawn_shell(&t.join("work/repo"), None, 80, 24, true).unwrap();
        p.writer.write_all(b"echo in-$(pwd | grep -c /work/repo)-$(ls -a ~ | grep -c -e ssh -e Documents); exit\r").unwrap();
        let (mut out, mut buf) = (String::new(), [0u8; 4096]);
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 { break; }
            out.push_str(&String::from_utf8_lossy(&buf[..n]));
        }
        assert!(out.contains("in-1-0"), "in the repo, in a home without yours: {out}");
        fs::remove_dir_all(t).unwrap();
    }

    #[test]
    fn shell_runs_in_pty() {
        let (mut p, mut reader) = spawn_shell(&std::env::temp_dir(), None, 80, 24, false).unwrap();
        p.writer.write_all(b"echo mide-$((40+2))$0; exit\r").unwrap();
        let mut out = String::new();
        let mut buf = [0u8; 4096];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 { break; }
            out.push_str(&String::from_utf8_lossy(&buf[..n]));
            if out.contains("mide-42") { break; }
        }
        let _ = p.child.kill();
        assert!(out.contains("mide-42"), "pty output: {out}");
        assert!(!out.contains("mide-42-"), "a login shell (argv0 `-bash`) skips ~/.bashrc: {out}");
    }

    /// A channel that records every message, like a window would receive them.
    fn sink() -> (Channel<InvokeResponseBody>, Arc<Mutex<Vec<Vec<u8>>>>) {
        let got = Arc::new(Mutex::new(Vec::new()));
        let g = got.clone();
        (Channel::new(move |b| { if let InvokeResponseBody::Raw(v) = b { g.lock().unwrap().push(v); } Ok(()) }), got)
    }
    fn text(got: &Mutex<Vec<Vec<u8>>>) -> String { String::from_utf8_lossy(&got.lock().unwrap().concat()).into() }
    fn until(f: impl Fn() -> bool) {
        for _ in 0..100 { if f() { return; } std::thread::sleep(std::time::Duration::from_millis(50)); }
        panic!("timed out");
    }

    #[test]
    fn reset_ends_every_shell() {
        let ptys = Ptys::default();
        let (p, _reader) = spawn_shell(&std::env::temp_dir(), None, 80, 24, false).unwrap();
        let pid = p.child.process_id().unwrap();
        ptys.0.lock().unwrap().insert(1, p);
        ptys.reset();
        assert!(ptys.0.lock().unwrap().is_empty(), "no tab left to re-attach to");
        until(|| !std::path::Path::new(&format!("/proc/{pid}")).exists() || fs::read_to_string(format!("/proc/{pid}/stat")).is_ok_and(|s| s.contains(") Z")));
    }

    #[test]
    fn out_replays_and_reports_exit() {
        let mut o = Out::default();
        let (a, got_a) = sink();
        o.attach(a);
        assert!(got_a.lock().unwrap().is_empty(), "nothing to replay, and no empty message: that reads as exit");
        o.push(b"hello ");
        let (b, got_b) = sink();
        o.attach(b);
        o.push(b"world");
        assert_eq!(text(&got_a), "hello ", "the old window stops receiving");
        assert_eq!(text(&got_b), "hello world", "the new one gets the replay, then live output");
        o.push(&vec![b'x'; SCROLLBACK]);
        assert_eq!(o.buf.len(), SCROLLBACK, "scrollback is capped");
        o.finish();
        assert!(got_b.lock().unwrap().last().unwrap().is_empty(), "exit signal to the attached window");
        let (c, got_c) = sink();
        o.attach(c);
        let msgs = got_c.lock().unwrap();
        assert_eq!((msgs.len(), msgs[1].is_empty()), (2, true), "attaching after exit: replay, then the exit signal");
    }

    #[test]
    fn shell_keeps_running_across_windows() {
        let (mut p, reader) = spawn_shell(&std::env::temp_dir(), None, 80, 24, false).unwrap();
        let (a, _) = sink();
        p.out.lock().unwrap().attach(a);
        let o = p.out.clone();
        std::thread::spawn(move || pump(reader, o));
        p.writer.write_all(b"echo mide-$((40+2))\r").unwrap();
        until(|| String::from_utf8_lossy(&p.out.lock().unwrap().buf.iter().copied().collect::<Vec<_>>()).contains("mide-42"));
        let (b, got_b) = sink();
        p.out.lock().unwrap().attach(b);
        p.writer.write_all(b"echo again-$((1+1))\r").unwrap();
        until(|| text(&got_b).contains("again-2"));
        let _ = p.child.kill();
        assert!(text(&got_b).contains("mide-42"), "earlier output replayed to the second window");
    }

    /// Calls the real `claude` CLI (costs a review): `cargo test -- --ignored review_runs_claude`
    #[test]
    #[ignore]
    fn review_runs_claude() {
        let root = std::env::temp_dir().join(format!("nimbus-review-{}", std::process::id()));
        let repo = root.join("calc");
        fs::create_dir_all(&repo).unwrap();
        std::env::set_var("NIMBUS_WORKFOLDER", &root);
        let g = |args: &[&str]| run(&repo, "git", args).unwrap();
        g(&["init", "-q", "-b", "main"]);
        fs::write(repo.join("calc.py"), "def average(xs):\n    return sum(xs) / len(xs)\n").unwrap();
        g(&["add", "."]);
        g(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "calc"]);
        fs::write(repo.join("calc.py"), "def average(xs):\n    return sum(xs) / (len(xs) - 1)\n").unwrap();
        use tauri::async_runtime::block_on as block;
        let r = block(review("calc".into(), "Review the uncommitted changes in this repository. Run `git diff HEAD` to see them.".into())).unwrap();
        println!("{}\n{}", r.summary, serde_json::to_string_pretty(&r.findings).unwrap());
        assert!(!r.session.is_empty() && r.findings.iter().any(|f| f.path.ends_with("calc.py") && f.severity == "high"));
        let a = block(review_ask("calc".into(), r.session, "In one sentence: what input makes it crash?".into())).unwrap();
        println!("Q&A: {a}");
        assert!(!a.is_empty());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn old_nb_install_moves_to_nimbus_once() {
        let h = std::env::temp_dir().join(format!("nimbus-home-{}", std::process::id()));
        let (bin, apps, icons, desk) = (h.join(".local/bin"), h.join(".local/share/applications"), h.join(".local/share/icons/hicolor/512x512/apps"), h.join("Desktop"));
        for d in [&bin, &apps, &icons, &desk] { fs::create_dir_all(d).unwrap(); }
        fs::write(bin.join("nb"), "binary").unwrap();
        fs::write(icons.join("nb.png"), "png").unwrap();
        fs::write(apps.join("nb.desktop"), "old").unwrap();
        fs::write(desk.join("nb.desktop"), "old").unwrap();
        assert!(!migrate_install(&h, &bin.join("elsewhere"), &desk), "only the ~/.local/bin/nb install moves");
        assert!(migrate_install(&h, &bin.join("nb"), &desk));
        assert_eq!(fs::read_to_string(bin.join("nimbus")).unwrap(), "binary");
        assert_eq!(fs::read_link(bin.join("nb")).unwrap(), PathBuf::from("nimbus"));
        assert!(icons.join("nimbus.png").exists() && !apps.join("nb.desktop").exists() && !desk.join("nb.desktop").exists());
        let entry = fs::read_to_string(desk.join("nimbus.desktop")).unwrap();
        assert!(entry.contains("Name=Nimbus") && entry.contains(&format!("Exec={}", bin.join("nimbus").display())));
        assert!(!migrate_install(&h, &bin.join("nb"), &desk), "the second run leaves the symlink alone");
        fs::remove_dir_all(&h).unwrap();
    }

    #[test]
    fn project_files_are_a_fixed_list() {
        use std::os::unix::fs::PermissionsExt;
        let d = std::env::temp_dir().join(format!("nimbus-pfiles-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        let files = |pairs: &[(&str, &str)]| pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<HashMap<_, _>>();
        write_project_files(&d, &files(&[("run.sh", "#!/bin/sh\n"), (".claude/settings.json", "{}"), ("REPORT.html", "<p>"), ("REPORT.json", "{}"), ("results.tsv", "h\n")])).unwrap();
        assert_eq!(fs::metadata(d.join("run.sh")).unwrap().permissions().mode() & 0o777, 0o755, "run.sh can be run");
        assert_eq!(fs::read_to_string(d.join(".claude/settings.json")).unwrap(), "{}");
        assert!(d.join("REPORT.html").exists() && d.join("results.tsv").exists(), "an HTML-report project can be created");
        for bad in ["../escaped", "notes.md", ".claude/other.json", "run.sh/x"] {
            assert!(write_project_files(&d, &files(&[(bad, "x")])).is_err(), "{bad} is not a project file");
        }
        assert!(!d.parent().unwrap().join("escaped").exists());
        fs::remove_dir_all(&d).unwrap();
    }
}
