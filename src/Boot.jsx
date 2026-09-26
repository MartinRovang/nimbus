// Startup: check for a signed release, install it behind a small splash, relaunch. Otherwise start the app.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import App from "./App.jsx";
import sky from "./assets/sky.webp";
import icon from "./assets/icon.webp";

/** The newer release, or null (none, offline, dev build, or slower than `ms`). */
export const checkUpdate = (ms) =>
  import.meta.env.DEV ? Promise.resolve(null) : Promise.race([check().catch(() => null), new Promise((r) => setTimeout(() => r(null), ms))]);

/** Downloads, verifies the signature, writes the new binary over this one and relaunches it. */
export async function install(update, onProgress) {
  let total = 0, got = 0;
  await update.downloadAndInstall((e) => {
    if (e.event === "Started") total = e.data.contentLength || 0;
    else if (e.event === "Progress") { got += e.data.chunkLength; onProgress(total ? got / total : null); }
    else onProgress(1);
  });
  await invoke("restart");
}

export function Splash({ label, sub, progress }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(rgba(12,12,24,.55), rgba(12,12,24,.8)), url(${sky}) center/cover`, animation: "rise .2s ease-out" }}>
      <div style={{ width: 280, textAlign: "center" }}>
        <img src={icon} alt="" width={104} height={104} style={{ filter: "drop-shadow(0 8px 30px rgba(145,132,217,.45))" }} />
        <div style={{ marginTop: 18, fontSize: 15, fontWeight: 500 }}>{label}</div>
        <div style={{ marginTop: 4, fontSize: 12, color: "var(--mid)", minHeight: 16 }}>{sub}</div>
        <div style={{ margin: "18px auto 0", width: 180, height: 3, borderRadius: 3, background: "rgba(233,233,237,.1)", overflow: "hidden" }}>
          <div style={{ height: "100%", borderRadius: 3, background: "linear-gradient(90deg, var(--acc), var(--gold))", width: progress == null ? "35%" : `${Math.round(progress * 100)}%`, transition: "width .2s", animation: progress == null ? "slide 1.1s ease-in-out infinite" : "none" }} />
        </div>
      </div>
    </div>
  );
}

export default function Boot() {
  const [s, setS] = useState({ phase: import.meta.env.DEV ? "ready" : "checking" });
  useEffect(() => {
    if (s.phase !== "checking") return;
    checkUpdate(4000).then(async (u) => {
      if (!u) return setS({ phase: "ready" });
      setS({ phase: "updating", version: u.version, p: 0 });
      try { await install(u, (p) => setS((x) => ({ ...x, p }))); }
      catch (e) { setS({ phase: "ready", err: "Update failed: " + e }); }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (s.phase === "ready") return <App bootError={s.err} />;
  return s.phase === "checking"
    ? <Splash label="nb" sub="Looking for updates…" progress={null} />
    : <Splash label={`Updating to ${s.version}`} sub={s.p >= 1 ? "Restarting…" : "Downloading…"} progress={s.p} />;
}
