// `nimbus mcp`: an MCP server (stdio, JSON-RPC one message per line) for the Claude that Nimbus starts in a project.
// Project tools edit the project's files, so they work with Nimbus closed; app tools reach the running Nimbus over a
// socket only this user can open. Every write also asks the app to refresh, so the project page updates at once.
use crate::{dir, link, reserve, root, run, set_parked, write_page_data, PROJECT};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    os::unix::net::{UnixListener, UnixStream},
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::async_runtime::block_on;

/// The phase ids, in order; the same as PHASES in src/lib.js (the page and CLAUDE.md read those).
const PHASES: [&str; 5] = ["start", "dev", "test", "review", "merge"];

/// Where the running Nimbus listens. XDG_RUNTIME_DIR is private to the user; the socket is 0600 besides.
// ponytail: one socket per user, so with two Nimbus open (dev + installed) the last one started gets the calls
pub fn socket_path() -> PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join("nimbus.sock")
}

/// In the app: accept one JSON line per connection and hand it to `on`; answers "ok" or the error.
pub fn listen(on: impl Fn(Value) -> Result<(), String> + Send + 'static) {
    let p = socket_path();
    let _ = fs::remove_file(&p);
    let Ok(l) = UnixListener::bind(&p) else { return };
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(&p, fs::Permissions::from_mode(0o600));
    std::thread::spawn(move || {
        for mut s in l.incoming().flatten() {
            let mut line = String::new();
            let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
            if BufReader::new(&s).read_line(&mut line).is_err() {
                continue;
            }
            let res = serde_json::from_str(&line).map_err(|e| e.to_string()).and_then(&on);
            let _ = writeln!(s, "{}", res.err().unwrap_or_else(|| "ok".into()));
        }
    });
}

/// The agent states the sidebar shows; "idle" clears the mark.
const STATES: [&str; 4] = ["working", "waiting", "done", "idle"];

/// What Claude is told about this server when it connects.
const INSTRUCTIONS: &str = "You are running in a terminal of Nimbus, the user's IDE; these tools show things there. \
Follow this alongside the user's own instructions, which come first where the two differ. \
Call set_status with working when you start a task and with done or waiting when you stop. \
When the work spans more than one repo, call set_links to say how they connect, and again when that changes. \
Outside a project, keep the user's report current with set_report: call it when you start a task that takes more than one step, \
and again as tasks get done; put your open questions, the things the user should consider and what you decided in it too, not only the tasks. It is how the user follows the work without reading the terminal. \
workfolder_repos lists the repos; add_repo brings one in. The project tools only work inside a Nimbus project folder.";

/// The same server outside a Nimbus terminal (it is in the user's own Claude config, Settings → "Nimbus tools in every Claude").
const OUTSIDE: &str = "These tools reach Nimbus, the user's IDE, but this session does not run in one of its terminals: use them only when the user asks for something shown in Nimbus.";

/// What a connecting Claude is told: every terminal Nimbus opens has NIMBUS set (NIMBUS_REPO: one opened before that was added).
fn instructions(in_nimbus: bool) -> &'static str {
    if in_nimbus { INSTRUCTIONS } else { OUTSIDE }
}

/// Marks a sidebar row with an agent's state: the terminal's repo (NIMBUS_REPO, set by Nimbus), else the folder `d`.
fn status(d: &Path, sock: &Path, state: &str, text: &Value) -> Result<(), String> {
    if !STATES.contains(&state) {
        return Err(format!("no state {state}: one of {}", STATES.join(", ")));
    }
    let repo = std::env::var("NIMBUS_REPO").ok().or_else(|| d.file_name()?.to_str().map(String::from)).unwrap_or_default();
    tell(sock, json!({"do": "status", "repo": repo, "state": state, "text": text}))
}

/// `nimbus hook <state>`: what Claude Code's hooks run. Never fails the hook: with Nimbus closed it does nothing.
pub fn hook(state: &str) {
    let _ = std::io::copy(&mut std::io::stdin(), &mut std::io::sink()); // the hook's JSON; read so Claude never hits a closed pipe
    let _ = status(&std::env::current_dir().unwrap_or_default(), &socket_path(), state, &Value::Null);
}

/// Sends one message to the running Nimbus.
fn tell(p: &Path, msg: Value) -> Result<(), String> {
    let mut s = UnixStream::connect(p).map_err(|_| "Nimbus isn't running".to_string())?;
    let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
    writeln!(s, "{msg}").map_err(|e| e.to_string())?;
    let mut back = String::new();
    BufReader::new(&s).read_line(&mut back).map_err(|e| e.to_string())?;
    match back.trim() {
        "ok" => Ok(()),
        e => Err(e.into()),
    }
}

fn tools() -> Value {
    let obj = |props: Value, req: &[&str]| json!({"type": "object", "properties": props, "required": req});
    let strs = |d: &str| json!({"type": "array", "items": {"type": "string"}, "description": d});
    let page = json!({"type": "string", "description": "a page at the top of the project folder, e.g. PLAN.html"});
    json!([
        {"name": "project_status", "description": "The project Claude is working in: goal, current phase, phases in order, repos, where the report goes, and its pages.", "inputSchema": obj(json!({}), &[])},
        {"name": "set_phase", "description": "Move the project to a phase (only after the user agreed). Nimbus shows it on the project page.", "inputSchema": obj(json!({"phase": {"type": "string", "enum": PHASES}}), &["phase"])},
        {"name": "page_data_get", "description": "Read a page's data (PLAN.html -> PLAN.json): what the page shows and what the user ticked, typed or answered there. null if none yet.", "inputSchema": obj(json!({"page": page}), &["page"])},
        {"name": "page_data_set", "description": "Replace a page's data (PLAN.html -> PLAN.json); the page re-renders from it straight away. Read it first: the user may have changed it.", "inputSchema": obj(json!({"page": page, "data": {"description": "any JSON value"}}), &["page", "data"])},
        {"name": "show", "description": "Open this project's page in Nimbus, on a page's tab if given (else the report).", "inputSchema": obj(json!({"page": page}), &[])},
        {"name": "open_file", "description": "Open a file of one of the project's repos in Nimbus's editor, at a line if given.", "inputSchema": obj(json!({"repo": {"type": "string"}, "path": {"type": "string", "description": "relative to the repo"}, "line": {"type": "integer"}}), &["repo", "path"])},
        {"name": "set_status", "description": "Mark this terminal's repo in Nimbus's sidebar: working, waiting (for the user), done, or idle to clear it. Set working when you start a task and done or waiting when you stop.", "inputSchema": obj(json!({"state": {"type": "string", "enum": STATES}, "text": {"type": "string", "description": "optional short note shown on hover"}}), &["state"])},
        {"name": "set_links", "description": "Tell the user how the workfolder's repos connect for the work at hand, e.g. web calls an endpoint you are changing in api. Nimbus shows the list on its home screen. Each call replaces the list; an empty one clears it.", "inputSchema": obj(json!({"links": {"type": "array", "items": obj(json!({"from": {"type": "string", "description": "a repo's name in the workfolder"}, "to": {"type": "string", "description": "the repo it depends on or feeds"}, "why": {"type": "string", "description": "one short line"}}), &["from", "to"])}}), &["links"])},
        {"name": "set_report", "description": "Show the user a short report of the work at hand on Nimbus's home screen: what it is, the tasks and how far they are, what blocks it, what you need answered, what the user should consider, what you decided and why, what comes next. Fill what applies, not only the tasks. For work outside a project (a project has its own REPORT.json). Each call replaces the report, so send all of it; no arguments clears it.", "inputSchema": obj(json!({"title": {"type": "string", "description": "the work in a few words"}, "summary": {"type": "string", "description": "one or two sentences: the goal and where it stands"}, "repos": strs("the repos it touches, by their names in the workfolder"), "tasks": {"type": "array", "items": obj(json!({"text": {"type": "string"}, "done": {"type": "boolean"}}), &["text"])}, "blockers": strs("what is in the way"), "questions": strs("open questions: what you need the user to answer"), "consider": strs("things the user should weigh: trade-offs, risks, side effects, what you assumed"), "decisions": {"type": "array", "items": obj(json!({"text": {"type": "string"}, "why": {"type": "string"}}), &["text"])}, "sections": {"type": "array", "description": "anything else worth a box of its own", "items": obj(json!({"title": {"type": "string"}, "items": {"type": "array", "items": {"type": "string"}}}), &["title", "items"])}, "next": strs("next steps, in order")}), &[])},
        {"name": "workfolder_repos", "description": "The repos in Nimbus's workfolder: the ones showing (in) and the ones put away in reserve (parked).", "inputSchema": obj(json!({}), &[])},
        {"name": "add_repo", "description": "Bring a repo or folder you work on into Nimbus's workfolder so the user sees it: an absolute path links a folder from elsewhere in (it is not moved), a name takes a parked repo out of reserve. With project, also adds it to this project, as the project's own worktree if it is a git repo.", "inputSchema": obj(json!({"repo": {"type": "string", "description": "an absolute path, or the name of a repo in the workfolder"}, "project": {"type": "boolean", "description": "also add it to this project"}}), &["repo"])},
        {"name": "park_repo", "description": "Put a repo away in reserve: out of Nimbus's sidebar, nothing is deleted. add_repo brings it back.", "inputSchema": obj(json!({"repo": {"type": "string", "description": "its name in the workfolder"}}), &["repo"])},
        {"name": "notify", "description": "Show a short message in Nimbus, e.g. when a sprint is done or you need the user.", "inputSchema": obj(json!({"text": {"type": "string"}}), &["text"])},
    ])
}

/// Brings `repo` into the workfolder and out of reserve: a path is linked in, a name must be there already. Returns its id.
fn bring_in(repo: &str) -> Result<String, String> {
    let id = if repo.contains('/') {
        let src = Path::new(repo).canonicalize().map_err(|e| format!("{repo}: {e}"))?;
        let name = src.file_name().and_then(|n| n.to_str()).filter(|_| src.is_dir()).ok_or(format!("{repo} is not a folder"))?.to_string();
        // in the workfolder already (itself, or linked before): nothing to link
        if dir(&name)?.canonicalize().is_ok_and(|p| p == src) { name } else { block_on(link(repo.into()))? }
    } else {
        repo.to_string()
    };
    if !dir(&id)?.is_dir() {
        return Err(format!("no {id} in the workfolder: give its full path to link it in"));
    }
    block_on(set_parked(id.clone(), false))?;
    Ok(id)
}

/// Adds workfolder repo `repo` to the project in `d`, as save_project and saveProject (src/App.jsx) do: a git repo gets
/// the project's own worktree <repo>@<project>, a plain folder is linked as it is. Returns the member's id.
fn into_project(d: &Path, cfg: &mut Value, project: &str, repo: &str) -> Result<String, String> {
    let (src, b) = (dir(repo)?, project.split_whitespace().collect::<Vec<_>>().join("-")); // projBranch in src/lib.js
    let tree = format!("{repo}@{b}");
    let mut list = cfg["repos"].as_array().cloned().unwrap_or_default();
    if list.iter().any(|x| x == repo || *x == json!(tree)) {
        return Err(format!("{repo} is already in this project"));
    }
    let member = if src.join(".git").exists() {
        let path = dir(&tree)?;
        let p = path.to_string_lossy();
        if !path.exists() && run(&src, "git", &["worktree", "add", &p, &b]).is_err() {
            // always from main (master where that is the repo's main), fresh from origin when it can be fetched: mainOf in src/ui.jsx
            let m = if run(&src, "git", &["rev-parse", "--verify", "-q", "refs/heads/main"]).is_err() && run(&src, "git", &["rev-parse", "--verify", "-q", "refs/heads/master"]).is_ok() { "master" } else { "main" };
            let base = if run(&src, "git", &["fetch", "origin", m]).is_ok() { format!("origin/{m}") } else { m.to_string() };
            run(&src, "git", &["worktree", "add", "--no-track", "-b", &b, &p, &base])?;
        }
        tree
    } else {
        repo.to_string()
    };
    if d.join(repo).symlink_metadata().is_err() {
        std::os::unix::fs::symlink(Path::new("..").join(&member), d.join(repo)).map_err(|e| e.to_string())?;
    }
    list.push(json!(member));
    cfg["repos"] = json!(list);
    fs::write(d.join(PROJECT), serde_json::to_string_pretty(&cfg).unwrap() + "\n").map_err(|e| e.to_string())?;
    // the repo list of the project's CLAUDE.md (projectRepos in src/lib.js)
    let end = "<!-- /nimbus:repos -->";
    if let Some(md) = fs::read_to_string(d.join("CLAUDE.md")).ok().filter(|m| m.contains(end)) {
        let _ = fs::write(d.join("CLAUDE.md"), md.replacen(end, &format!("- `{repo}/`\n{end}"), 1));
    }
    block_on(set_parked(member.clone(), false))?;
    Ok(member)
}

/// Runs one tool in project folder `d`; `sock` is where the app listens.
pub(crate) fn call(d: &Path, sock: &Path, name: &str, a: &Value) -> Result<String, String> {
    // works in any folder, not only a project, so any agent started in a Nimbus terminal can use it
    if name == "set_status" {
        return status(d, sock, a["state"].as_str().unwrap_or_default(), &a["text"]).map(|_| "set".into());
    }
    if name == "set_links" {
        let links = a["links"].as_array().ok_or("missing links")?;
        if links.iter().any(|l| ["from", "to"].iter().any(|k| l[k].as_str().is_none_or(str::is_empty))) {
            return Err("every link needs from and to: repo names".into());
        }
        return tell(sock, json!({"do": "links", "links": links})).map(|_| "shown".into());
    }
    if name == "set_report" {
        let clear = a.as_object().is_none_or(|o| o.is_empty());
        if !clear && a["title"].as_str().is_none_or(str::is_empty) {
            return Err("a report needs a title; no arguments clears it".into());
        }
        return tell(sock, json!({"do": "report", "report": if clear { &Value::Null } else { a }})).map(|_| if clear { "cleared" } else { "shown" }.into());
    }
    let s = |k: &str| a[k].as_str().ok_or(format!("missing {k}"));
    let id = d.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
    // the workfolder tools too: an agent in any repo can bring in what it works on
    let reload = |project: Option<&str>| { let _ = tell(sock, json!({"do": "reload", "project": project})); };
    match name {
        "workfolder_repos" => {
            let parked = reserve();
            let mut all: Vec<String> = fs::read_dir(root()).into_iter().flatten().flatten()
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|n| !n.starts_with('.') && root().join(n).is_dir()).collect();
            all.sort();
            let (out, r#in): (Vec<_>, Vec<_>) = all.into_iter().partition(|n| parked.contains(n));
            return Ok(json!({"workfolder": root(), "in": r#in, "parked": out}).to_string());
        }
        "park_repo" => {
            let repo = s("repo")?;
            if !dir(repo)?.is_dir() {
                return Err(format!("no {repo} in the workfolder"));
            }
            block_on(set_parked(repo.into(), true))?;
            reload(None);
            return Ok(format!("{repo} is parked"));
        }
        "add_repo" if a["project"] != true => {
            let repo = bring_in(s("repo")?)?;
            reload(None);
            return Ok(format!("{repo} is in the workfolder"));
        }
        _ => {}
    }
    let cfg_path = d.join(PROJECT);
    let mut cfg: Value = fs::read_to_string(&cfg_path).ok().and_then(|t| serde_json::from_str(&t).ok())
        .ok_or("not in a Nimbus project: start Claude from the project's page")?;
    let refresh = || { let _ = tell(sock, json!({"do": "refresh", "project": id})); };
    match name {
        "project_status" => {
            let mut pages: Vec<String> = fs::read_dir(d).map_err(|e| e.to_string())?.flatten()
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|f| f.ends_with(".html") || f.ends_with(".htm")).collect();
            pages.sort();
            Ok(json!({"project": id, "goal": cfg["goal"], "phase": cfg["phase"], "phases": PHASES, "repos": cfg["repos"], "report": cfg["report"], "pages": pages}).to_string())
        }
        "set_phase" => {
            let ph = s("phase")?;
            if !PHASES.contains(&ph) {
                return Err(format!("no phase {ph}: one of {}", PHASES.join(", ")));
            }
            cfg["phase"] = json!(ph);
            fs::write(&cfg_path, serde_json::to_string_pretty(&cfg).unwrap() + "\n").map_err(|e| e.to_string())?;
            refresh();
            Ok(format!("phase is now {ph}"))
        }
        "page_data_get" => {
            let page = s("page")?;
            write_page_data(d, page, None)?; // only checks the page
            Ok(fs::read_to_string(d.join(page.rsplit_once('.').unwrap().0.to_string() + ".json")).unwrap_or_else(|_| "null".into()))
        }
        "page_data_set" => {
            write_page_data(d, s("page")?, Some(&(serde_json::to_string_pretty(&a["data"]).unwrap() + "\n")))?;
            refresh();
            Ok("saved".into())
        }
        "show" => tell(sock, json!({"do": "show", "project": id, "page": a["page"]})).map(|_| "shown".into()),
        "open_file" => {
            let repo = s("repo")?;
            if !cfg["repos"].as_array().is_some_and(|r| r.iter().any(|x| x == repo)) {
                return Err(format!("{repo} is not one of this project's repos"));
            }
            tell(sock, json!({"do": "open_file", "repo": repo, "path": s("path")?, "line": a["line"]})).map(|_| "opened".into())
        }
        "add_repo" => {
            let member = into_project(d, &mut cfg, &id, &bring_in(s("repo")?)?)?;
            reload(Some(&id));
            Ok(format!("{member} is in the workfolder and in the project {id}"))
        }
        "notify" => tell(sock, json!({"do": "notify", "project": id, "text": s("text")?})).map(|_| "shown".into()),
        _ => Err(format!("no tool {name}")),
    }
}

/// Answers one JSON-RPC message; None for notifications, which get no reply.
fn handle(d: &Path, sock: &Path, m: &Value) -> Option<Value> {
    let id = m.get("id")?.clone();
    let result = match m["method"].as_str().unwrap_or_default() {
        "initialize" => json!({
            "protocolVersion": m["params"]["protocolVersion"].as_str().unwrap_or("2025-06-18"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "nimbus", "version": env!("CARGO_PKG_VERSION")},
            "instructions": instructions(["NIMBUS", "NIMBUS_REPO"].iter().any(|k| std::env::var_os(k).is_some())),
        }),
        "ping" => json!({}),
        "tools/list" => json!({"tools": tools()}),
        "tools/call" => {
            let args = m["params"].get("arguments").cloned().unwrap_or(json!({}));
            match call(d, sock, m["params"]["name"].as_str().unwrap_or_default(), &args) {
                Ok(text) => json!({"content": [{"type": "text", "text": text}]}),
                Err(e) => json!({"content": [{"type": "text", "text": e}], "isError": true}),
            }
        }
        other => return Some(json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32601, "message": format!("no method {other}")}})),
    };
    Some(json!({"jsonrpc": "2.0", "id": id, "result": result}))
}

/// `nimbus mcp`: serves the project in the current directory until stdin closes.
pub fn serve() {
    let d = std::env::current_dir().unwrap_or_default();
    let (sock, mut out) = (socket_path(), std::io::stdout());
    for line in std::io::stdin().lock().lines().map_while(Result::ok) {
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(m) => handle(&d, &sock, &m),
            Err(e) => Some(json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": e.to_string()}})),
        };
        if let Some(r) = reply {
            let _ = writeln!(out, "{r}");
            let _ = out.flush();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serves_a_project() {
        let d = std::env::temp_dir().join(format!("nimbus-mcp-{}", std::process::id())).join("proj");
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join(PROJECT), r#"{"goal":"g","phase":"start","repos":["api"]}"#).unwrap();
        fs::write(d.join("PLAN.html"), "<p>").unwrap();
        let sock = d.parent().unwrap().join("s.sock");
        let got = std::sync::Arc::new(std::sync::Mutex::new(vec![]));
        let seen = got.clone();
        let _ = fs::remove_file(&sock);
        let l = UnixListener::bind(&sock).unwrap();
        std::thread::spawn(move || for mut s in l.incoming().flatten() {
            let mut line = String::new();
            BufReader::new(&s).read_line(&mut line).unwrap();
            seen.lock().unwrap().push(serde_json::from_str::<Value>(&line).unwrap());
            writeln!(s, "ok").unwrap();
        });
        let rpc = |method: &str, params: Value| handle(&d, &sock, &json!({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})).unwrap();
        let tool = |name: &str, args: Value| { let r = rpc("tools/call", json!({"name": name, "arguments": args}))["result"].clone(); (r["content"][0]["text"].as_str().unwrap().to_string(), r["isError"] == true) };

        assert_eq!(rpc("initialize", json!({"protocolVersion": "2025-03-26"}))["result"]["protocolVersion"], "2025-03-26");
        assert!(rpc("initialize", json!({}))["result"]["instructions"].is_string());
        assert!(["set_status", "set_links", "set_report"].iter().all(|t| instructions(true).contains(t)));
        assert!(!instructions(false).contains("You are running in"), "a Claude elsewhere is not told it is in Nimbus");
        assert!(handle(&d, &sock, &json!({"jsonrpc": "2.0", "method": "notifications/initialized"})).is_none());
        assert_eq!(rpc("tools/list", json!({}))["result"]["tools"].as_array().unwrap().len(), 13);
        assert_eq!(rpc("nope", json!({}))["error"]["code"], -32601);

        let st: Value = serde_json::from_str(&tool("project_status", json!({})).0).unwrap();
        assert_eq!((st["project"].as_str(), st["phase"].as_str(), st["pages"][0].as_str()), (Some("proj"), Some("start"), Some("PLAN.html")));
        assert!(tool("set_phase", json!({"phase": "later"})).1);
        assert!(!tool("set_phase", json!({"phase": "dev"})).1);
        let cfg: Value = serde_json::from_str(&fs::read_to_string(d.join(PROJECT)).unwrap()).unwrap();
        assert_eq!((cfg["phase"].as_str(), cfg["goal"].as_str()), (Some("dev"), Some("g")), "only the phase changes");

        assert_eq!(tool("page_data_get", json!({"page": "PLAN.html"})), ("null".into(), false));
        assert!(!tool("page_data_set", json!({"page": "PLAN.html", "data": {"done": [1]}})).1);
        assert_eq!(serde_json::from_str::<Value>(&tool("page_data_get", json!({"page": "PLAN.html"})).0).unwrap(), json!({"done": [1]}));
        assert!(tool("page_data_set", json!({"page": "../x.html", "data": 1})).1);

        assert!(tool("open_file", json!({"repo": "web", "path": "a"})).1, "only the project's repos");
        assert!(!tool("open_file", json!({"repo": "api", "path": "a", "line": 3})).1);
        assert!(!tool("notify", json!({"text": "hi"})).1);
        assert!(tool("set_status", json!({"state": "asleep"})).1);
        assert!(!tool("set_status", json!({"state": "done"})).1);
        assert_eq!(got.lock().unwrap().last().unwrap()["repo"], std::env::var("NIMBUS_REPO").unwrap_or("proj".into()));
        assert!(tool("set_links", json!({"links": [{"from": "web"}]})).1, "a link names both repos");
        assert!(!tool("set_links", json!({"links": [{"from": "web", "to": "api", "why": "calls /auth"}]})).1);
        assert_eq!(got.lock().unwrap().last().unwrap()["links"][0]["to"], "api");
        assert!(tool("set_report", json!({"summary": "no title"})).1, "a report has a title");
        assert!(!tool("set_report", json!({"title": "Auth", "tasks": [{"text": "endpoint", "done": true}]})).1);
        assert_eq!(got.lock().unwrap().last().unwrap()["report"]["tasks"][0]["done"], true);
        assert_eq!(tool("set_report", json!({})).0, "cleared");
        assert!(got.lock().unwrap().last().unwrap()["report"].is_null());
        let msgs = got.lock().unwrap().iter().map(|m| m["do"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        assert_eq!(msgs, ["refresh", "refresh", "open_file", "notify", "status", "links", "report", "report"]);

        fs::remove_file(&sock).unwrap();
        assert_eq!(tool("notify", json!({"text": "hi"})), ("Nimbus isn't running".into(), true));
        assert!(!tool("set_phase", json!({"phase": "test"})).1, "file tools work with Nimbus closed");
        fs::remove_dir_all(d.parent().unwrap()).unwrap();
    }
}
