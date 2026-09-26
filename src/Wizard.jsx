// First-run wizard: welcome, GitHub, workfolder, Claude Code, first repos.
import { useEffect, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import sky from "./assets/sky.webp";
import icon from "./assets/icon.webp";
import { ThemePicker } from "./Settings.jsx";
import { settings, saveSettings } from "./settings.js";

const I = ({ n, style }) => <i className={"ph " + n} style={style} />;
const STEPS = ["Welcome", "Look", "GitHub", "Workfolder", "Claude", "Repos"];

export default function Wizard({ done, addRepos }) {
  const [step, setStep] = useState(0);
  const [st, setSt] = useState(null); // setup_status
  const [code, setCode] = useState(null);
  const [login, setLogin] = useState({ busy: false, err: "" });
  const [root, setRoot] = useState("");
  const [theme, setTheme] = useState(settings.theme);
  useEffect(() => { invoke("setup_status").then((x) => { setSt(x); setRoot(x.root); }); }, []);
  const next = () => setStep((s) => s + 1);

  const connect = async () => {
    setLogin({ busy: true, err: "" }); setCode(null);
    const ch = new Channel();
    ch.onmessage = (c) => { setCode(c); navigator.clipboard.writeText(c).catch(() => {}); };
    try { const user = await invoke("gh_login", { code: ch }); setSt((x) => ({ ...x, user })); setLogin({ busy: false, err: "" }); }
    catch (e) { setLogin({ busy: false, err: String(e) }); }
  };
  const choose = async () => { const p = await pickFolder({ directory: true }).catch(() => null); if (p) setRoot(p.replace(/^\/home\/[^/]+/, "~")); };
  const saveRoot = async () => { try { await invoke("set_root", { path: root }); next(); } catch (e) { setLogin({ busy: false, err: String(e) }); } };

  const Btn = ({ children, onClick, ghost, disabled }) => (
    <button className={ghost ? "ghost" : "btn"} onClick={onClick} disabled={disabled} style={{ height: 34, padding: "0 16px", fontSize: 13, justifyContent: "center" }}>{children}</button>
  );
  const Row = ({ ok, children }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18, color: ok ? "var(--soft)" : "var(--mid)" }}>
      <span style={{ width: 22, height: 22, flex: "none", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, background: ok ? "var(--chip)" : "transparent", boxShadow: ok ? "none" : "0 0 0 1px var(--dimmer)", color: ok ? "var(--acc-fg)" : "var(--dim)" }}><I n={ok ? "ph-check" : "ph-minus"} /></span>
      <span style={{ lineHeight: 1.5 }}>{children}</span>
    </div>
  );

  const page = !st ? <div style={{ color: "var(--mid)", display: "flex", gap: 8, alignItems: "center" }}><I n="ph-circle-notch spin" />Checking your setup…</div> : [
    <>
      <img src={icon} alt="" width={120} height={120} style={{ display: "block", margin: "0 auto", filter: "drop-shadow(0 10px 36px color-mix(in srgb, var(--acc) 50%, transparent))" }} />
      <div style={{ marginTop: 20, fontSize: 26, fontWeight: 500, textAlign: "center" }}>Welcome to nb</div>
      <div style={{ marginTop: 10, color: "var(--mid)", lineHeight: 1.6, textAlign: "center" }}>One folder, many repositories. Branches, diffs, pull requests and an AI self-review follow whichever one you're in.</div>
      <div style={{ marginTop: 28, display: "flex", justifyContent: "center" }}><Btn onClick={next}>Get started<I n="ph-arrow-right" /></Btn></div>
    </>,
    <>
      <div style={{ fontSize: 20, fontWeight: 500 }}>Pick a look</div>
      <div style={{ marginTop: 8, marginBottom: 20, color: "var(--mid)", lineHeight: 1.6 }}>You can change it any time in Settings, and plugins can add more.</div>
      <ThemePicker value={theme} onPick={(t) => { setTheme(t); saveSettings({ theme: t }); }} />
      <div style={{ marginTop: 28 }}><Btn onClick={next}>Continue<I n="ph-arrow-right" /></Btn></div>
    </>,
    <>
      <div style={{ fontSize: 20, fontWeight: 500 }}>Connect GitHub</div>
      <div style={{ marginTop: 8, color: "var(--mid)", lineHeight: 1.6 }}>nb uses the GitHub CLI for your repositories, pull requests and publishing. Your token stays with <span className="mono">gh</span>; nb never sees it.</div>
      {st.user ? <Row ok>Connected as <b style={{ color: "var(--fg)" }}>{st.user}</b></Row>
        : !st.gh ? <Row>The GitHub CLI isn't installed. Get it from <span className="mono">cli.github.com</span>, or skip and add repos by URL or folder.</Row>
        : code ? (
          <div style={{ marginTop: 20, padding: 16, borderRadius: 10, background: "color-mix(in srgb, var(--bg) 70%, transparent)", boxShadow: "0 0 0 1px var(--border)" }}>
            <div style={{ fontSize: 12, color: "var(--mid)" }}>Your one-time code (copied). Paste it on the GitHub page that just opened.</div>
            <div className="mono" style={{ marginTop: 8, fontSize: 28, letterSpacing: ".12em", color: "var(--gold)" }}>{code}</div>
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--dim)" }}><I n="ph-circle-notch spin" />Waiting for you to approve on github.com/login/device…</div>
          </div>
        ) : null}
      {login.err && <div style={{ marginTop: 12, color: "var(--del)", fontSize: 12.5, lineHeight: 1.5 }}>{login.err}</div>}
      <div style={{ marginTop: 28, display: "flex", gap: 8 }}>
        {st.user ? <Btn onClick={next}>Continue<I n="ph-arrow-right" /></Btn>
          : st.gh && <Btn onClick={connect} disabled={login.busy}><I n="ph-github-logo" />{login.busy ? "Connecting…" : "Connect GitHub"}</Btn>}
        {!st.user && <Btn ghost onClick={next}>Skip for now</Btn>}
      </div>
    </>,
    <>
      <div style={{ fontSize: 20, fontWeight: 500 }}>Choose your workfolder</div>
      <div style={{ marginTop: 8, color: "var(--mid)", lineHeight: 1.6 }}>Every repo you add lives side by side here. Existing folders elsewhere get linked in, never moved.</div>
      <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
        <div className="mono" style={{ flex: 1, height: 34, display: "flex", alignItems: "center", padding: "0 12px", borderRadius: 8, background: "color-mix(in srgb, var(--bg) 70%, transparent)", boxShadow: "0 0 0 1px var(--border)", fontSize: 12.5 }}>{root}</div>
        <Btn ghost onClick={choose}><I n="ph-folder-open" />Choose…</Btn>
      </div>
      {login.err && <div style={{ marginTop: 12, color: "var(--del)", fontSize: 12.5 }}>{login.err}</div>}
      <div style={{ marginTop: 28 }}><Btn onClick={saveRoot}>Use {root}<I n="ph-arrow-right" /></Btn></div>
    </>,
    <>
      <div style={{ fontSize: 20, fontWeight: 500 }}>AI self-review</div>
      <div style={{ marginTop: 8, color: "var(--mid)", lineHeight: 1.6 }}>Before you commit, nb can ask Claude Code to review your changes, a file or a pull request. It runs <span className="mono">claude -p</span> in the repo with read-only tools; nothing is posted unless you post it.</div>
      {st.claude ? <Row ok>Found Claude Code <span className="mono" style={{ fontSize: 12 }}>{st.claude}</span></Row>
        : <Row>Claude Code isn't on your PATH. Install it from <span className="mono">claude.com/claude-code</span>; reviews switch on once it's there.</Row>}
      <div style={{ marginTop: 28 }}><Btn onClick={next}>Continue<I n="ph-arrow-right" /></Btn></div>
    </>,
    <>
      <div style={{ fontSize: 20, fontWeight: 500 }}>Bring in your first repos</div>
      <div style={{ marginTop: 8, color: "var(--mid)", lineHeight: 1.6 }}>Clone from GitHub, paste a git URL, or link a folder you already have.</div>
      <div style={{ marginTop: 28, display: "flex", gap: 8 }}>
        <Btn onClick={() => { done(); addRepos(); }}><I n="ph-plus" />Add repos</Btn>
        <Btn ghost onClick={done}>I'll do it later</Btn>
      </div>
    </>,
  ][step];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: `linear-gradient(rgba(12,12,24,.5), rgba(12,12,24,.82)), url(${sky}) center/cover` }}>
      <div key={step} style={{ width: 480, maxWidth: "100%", padding: "32px 36px 28px", borderRadius: 16, background: "color-mix(in srgb, var(--bg) 82%, transparent)", backdropFilter: "blur(14px)", boxShadow: "0 0 0 1px color-mix(in srgb, var(--fg) 8%, transparent), 0 24px 60px rgba(0,0,0,.55)", animation: "rise .18s ease-out" }}>
        {page}
        <div style={{ marginTop: 28, display: "flex", justifyContent: "center", gap: 6 }}>
          {STEPS.map((l, i) => <span key={l} title={l} style={{ width: i === step ? 18 : 6, height: 6, borderRadius: 3, background: i <= step ? "var(--acc)" : "color-mix(in srgb, var(--fg) 15%, transparent)", transition: "width .2s" }} />)}
        </div>
      </div>
    </div>
  );
}
