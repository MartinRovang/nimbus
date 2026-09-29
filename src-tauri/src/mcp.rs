// `nimbus mcp`: an MCP server (stdio, JSON-RPC one message per line) for the Claude that Nimbus starts in a project.
// Project tools edit the project's files, so they work with Nimbus closed; app tools reach the running Nimbus over a
// socket only this user can open. Every write also asks the app to refresh, so the project page updates at once.
use crate::{write_page_data, PROJECT};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    os::unix::net::{UnixListener, UnixStream},
    path::{Path, PathBuf},
    time::Duration,
};

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
    let page = json!({"type": "string", "description": "a page at the top of the project folder, e.g. PLAN.html"});
    json!([
        {"name": "project_status", "description": "The project Claude is working in: goal, current phase, phases in order, repos, where the report goes, and its pages.", "inputSchema": obj(json!({}), &[])},
        {"name": "set_phase", "description": "Move the project to a phase (only after the user agreed). Nimbus shows it on the project page.", "inputSchema": obj(json!({"phase": {"type": "string", "enum": PHASES}}), &["phase"])},
        {"name": "page_data_get", "description": "Read a page's data (PLAN.html -> PLAN.json): what the page shows and what the user ticked, typed or answered there. null if none yet.", "inputSchema": obj(json!({"page": page}), &["page"])},
        {"name": "page_data_set", "description": "Replace a page's data (PLAN.html -> PLAN.json); the page re-renders from it straight away. Read it first: the user may have changed it.", "inputSchema": obj(json!({"page": page, "data": {"description": "any JSON value"}}), &["page", "data"])},
        {"name": "show", "description": "Open this project's page in Nimbus, on a page's tab if given (else the report).", "inputSchema": obj(json!({"page": page}), &[])},
        {"name": "open_file", "description": "Open a file of one of the project's repos in Nimbus's editor, at a line if given.", "inputSchema": obj(json!({"repo": {"type": "string"}, "path": {"type": "string", "description": "relative to the repo"}, "line": {"type": "integer"}}), &["repo", "path"])},
        {"name": "notify", "description": "Show a short message in Nimbus, e.g. when a sprint is done or you need the user.", "inputSchema": obj(json!({"text": {"type": "string"}}), &["text"])},
    ])
}

/// Runs one tool in project folder `d`; `sock` is where the app listens.
fn call(d: &Path, sock: &Path, name: &str, a: &Value) -> Result<String, String> {
    let cfg_path = d.join(PROJECT);
    let mut cfg: Value = fs::read_to_string(&cfg_path).ok().and_then(|t| serde_json::from_str(&t).ok())
        .ok_or("not in a Nimbus project: start Claude from the project's page")?;
    let id = d.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
    let s = |k: &str| a[k].as_str().ok_or(format!("missing {k}"));
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
        assert!(handle(&d, &sock, &json!({"jsonrpc": "2.0", "method": "notifications/initialized"})).is_none());
        assert_eq!(rpc("tools/list", json!({}))["result"]["tools"].as_array().unwrap().len(), 7);
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
        let msgs = got.lock().unwrap().iter().map(|m| m["do"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        assert_eq!(msgs, ["refresh", "refresh", "open_file", "notify"]);

        fs::remove_file(&sock).unwrap();
        assert_eq!(tool("notify", json!({"text": "hi"})), ("Nimbus isn't running".into(), true));
        assert!(!tool("set_phase", json!({"phase": "test"})).1, "file tools work with Nimbus closed");
        fs::remove_dir_all(d.parent().unwrap()).unwrap();
    }
}
