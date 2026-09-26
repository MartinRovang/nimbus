use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};
use tauri::ipc::{Channel, InvokeResponseBody};

// ponytail: every command shells out to git/gh and blocks a runtime worker; fine for one user,
// move long ones (clone, push) to spawn_blocking + progress events if the UI ever stalls.

/// ~/.config/nb/workfolder holds the chosen folder; NB_WORKFOLDER overrides it, ~/work is the default.
fn config_path() -> PathBuf {
    std::env::var("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|_| home().join(".config")).join("nb").join("workfolder")
}

fn root() -> PathBuf {
    std::env::var("NB_WORKFOLDER")
        .ok()
        .or_else(|| fs::read_to_string(config_path()).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join("work"))
}

fn reserve_path() -> PathBuf {
    root().join(".nb-reserve")
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

fn repo_info(id: &str, parked: bool) -> Result<Repo, String> {
    let d = dir(id)?;
    let src = fs::read_link(&d).map(|t| tilde(&t)).unwrap_or_default();
    if !d.join(".git").exists() {
        let none = String::new;
        return Ok(Repo { id: id.into(), remote: none(), branch: none(), branches: vec![], changes: vec![], commits: vec![], parked, git: false, src });
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
    let commits = git(&["log", "-5", "--format=%h%x09%s%x09%cr"])
        .lines()
        .filter_map(|l| {
            let mut f = l.splitn(3, '\t');
            Some(Commit { sha: f.next()?.into(), msg: f.next()?.into(), when: f.next()?.into() })
        })
        .collect();
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
    })
}

#[tauri::command]
async fn load() -> Result<Workfolder, String> {
    let root = root();
    let parked = reserve();
    let mut repos = vec![];
    for e in fs::read_dir(&root).into_iter().flatten().flatten() {
        let id = e.file_name().to_string_lossy().into_owned();
        if !id.starts_with('.') && e.path().is_dir() {
            repos.push(repo_info(&id, parked.contains(&id))?);
        }
    }
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
    let bytes = fs::read(file_in(&id, &path)?).map_err(|e| e.to_string())?;
    if bytes.len() > 2_000_000 || bytes.iter().take(8000).any(|&b| b == 0) {
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
    let text = fs::read_to_string(file_in(&id, &path)?).map_err(|e| e.to_string())?;
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

// ---- terminal: one PTY per tab, output streamed to the page as raw bytes ----

struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
struct Ptys(Mutex<HashMap<u32, Pty>>);

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }
}

/// Starts the user's login shell in `dir`; returns the session and its output stream.
fn spawn_shell(dir: &Path, cols: u16, rows: u16) -> Result<(Pty, Box<dyn Read + Send>), String> {
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new_default_prog();
    cmd.cwd(dir);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    Ok((Pty { master: pair.master, writer, child }, reader))
}

/// Opens a shell; bytes arrive on `out`, and an empty message means the shell exited.
#[tauri::command]
fn pty_open(ptys: tauri::State<Ptys>, tab: u32, id: Option<String>, cols: u16, rows: u16, out: Channel<InvokeResponseBody>) -> Result<(), String> {
    let (pty, mut reader) = spawn_shell(&cwd(id)?, cols, rows)?;
    ptys.0.lock().unwrap().insert(tab, pty);
    std::thread::spawn(move || {
        let mut buf = [0u8; 16384];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 || out.send(InvokeResponseBody::Raw(buf[..n].to_vec())).is_err() {
                break;
            }
        }
        let _ = out.send(InvokeResponseBody::Raw(vec![]));
    });
    Ok(())
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
        configured: config_path().exists() || std::env::var("NB_WORKFOLDER").is_ok(),
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
    Command::new(&exe.0).env("NB_FOREGROUND", "1").process_group(0).spawn().map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

/// Where this binary was started from, read before an update can move it.
struct Exe(PathBuf);

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run_app() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Exe(std::env::current_exe().unwrap_or_default()))
        .manage(Ptys::default())
        .invoke_handler(tauri::generate_handler![
            load, repo, files, read_file, diff, git, gh, clone, make_root, set_parked, local_dirs, link, unlink, remove_repo, save_md, review, review_ask, set_root, setup_status, gh_login, restart, pty_open, pty_write, pty_resize, pty_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let root = std::env::temp_dir().join(format!("nb-test-{}", std::process::id()));
        let repo = root.join("demo");
        fs::create_dir_all(&repo).unwrap();
        std::env::set_var("NB_WORKFOLDER", &root);
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
        let plain = std::env::temp_dir().join(format!("nb-plain-{}", std::process::id()));
        fs::create_dir_all(plain.join("sub")).unwrap();
        fs::write(plain.join("sub/x.py"), "print(1)\n").unwrap();
        let name = block(link(plain.to_string_lossy().into())).unwrap();
        let wf = block(load()).unwrap();
        let p = wf.repos.iter().find(|r| r.id == name).unwrap();
        assert!(!p.git && p.src.contains("nb-plain-"));
        assert_eq!(block(files(name.clone())).unwrap(), ["sub/x.py"]);
        block(unlink(name.clone())).unwrap();
        assert!(plain.join("sub/x.py").exists(), "unlink must leave the real folder alone");
        fs::remove_dir_all(&plain).unwrap();
        block(set_parked("demo".into(), true)).unwrap();
        assert!(block(load()).unwrap().repos[0].parked);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn shell_runs_in_pty() {
        let (mut p, mut reader) = spawn_shell(&std::env::temp_dir(), 80, 24).unwrap();
        p.writer.write_all(b"echo mide-$((40+2)); exit\r").unwrap();
        let mut out = String::new();
        let mut buf = [0u8; 4096];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 { break; }
            out.push_str(&String::from_utf8_lossy(&buf[..n]));
            if out.contains("mide-42") { break; }
        }
        let _ = p.child.kill();
        assert!(out.contains("mide-42"), "pty output: {out}");
    }

    /// Calls the real `claude` CLI (costs a review): `cargo test -- --ignored review_runs_claude`
    #[test]
    #[ignore]
    fn review_runs_claude() {
        let root = std::env::temp_dir().join(format!("nb-review-{}", std::process::id()));
        let repo = root.join("calc");
        fs::create_dir_all(&repo).unwrap();
        std::env::set_var("NB_WORKFOLDER", &root);
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
}
