// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `nimbus mcp`: the MCP server Claude starts (see mcp.rs); no window
    if std::env::args().nth(1).as_deref() == Some("mcp") {
        return nimbus_lib::mcp_serve();
    }
    // Typed `nimbus` (or `nb`) in a shell: relaunch in the background so the prompt comes straight back.
    #[cfg(all(unix, not(debug_assertions)))]
    {
        use std::{io::IsTerminal, os::unix::process::CommandExt, process::{Command, Stdio}};
        if std::io::stdin().is_terminal() && std::env::var_os("NIMBUS_FOREGROUND").is_none() {
            if let Ok(exe) = std::env::current_exe() {
                let spawned = Command::new(exe)
                    .args(std::env::args_os().skip(1))
                    .env("NIMBUS_FOREGROUND", "1")
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .process_group(0)
                    .spawn();
                if spawned.is_ok() {
                    return;
                }
            }
        }
    }
    nimbus_lib::run_app()
}
