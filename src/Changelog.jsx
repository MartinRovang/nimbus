// "What's new": the CHANGELOG.md sections between the version last seen and this one.
import changelog from "../CHANGELOG.md?raw";
import sky from "./assets/sky.webp";
import { sectionsSince } from "./lib.js";

// **bold** and `code` are all the markdown the changelog uses
const inline = (t) => t.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((p, i) =>
  p.startsWith("**") ? <b key={i} style={{ color: "var(--fg)", fontWeight: 500 }}>{p.slice(2, -2)}</b>
  : p.startsWith("`") ? <code key={i} className="mono" style={{ fontSize: "0.92em", padding: "1px 5px", borderRadius: 4, background: "color-mix(in srgb, var(--fg) 7%, transparent)" }}>{p.slice(1, -1)}</code>
  : p);

export default function Changelog({ since, current, close }) {
  const secs = sectionsSince(changelog, since, current);
  return (
    <>
      <div className="scrim" onClick={close} style={{ zIndex: 60, background: "rgba(10,11,18,0.6)" }} />
      <div className="pop" style={{ position: "absolute", top: "10%", left: "50%", transform: "translateX(-50%)", width: 520, maxWidth: "calc(100% - 32px)", maxHeight: "80%", zIndex: 61, borderRadius: 14, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ height: 96, flex: "none", background: `linear-gradient(transparent 30%, var(--pop)), url(${sky}) center 40%/cover`, display: "flex", alignItems: "flex-end", padding: "0 24px 4px" }}>
          <div style={{ textShadow: "0 1px 12px rgba(0,0,0,.7)" }}>
            <div style={{ fontSize: 12, color: "#e9e9ed", opacity: 0.8 }}>{since ? `Updated from ${since}` : "Updated"}</div>
            <div style={{ fontSize: 20, fontWeight: 500, color: "#fff" }}>What's new in Nimbus {current}</div>
          </div>
        </div>
        <div style={{ overflow: "auto", padding: "12px 24px 4px", minHeight: 0 }}>
          {!secs.length && <div style={{ color: "var(--dim)" }}>No notes for this version.</div>}
          {secs.map((s) => (
            <div key={s.version} style={{ marginBottom: 18 }}>
              {secs.length > 1 && <div className="label" style={{ marginBottom: 8 }}>{s.version}<span style={{ textTransform: "none", letterSpacing: 0, marginLeft: 8, color: "var(--dimmer)" }}>{s.date}</span></div>}
              {s.items.map((it, i) => (
                <div key={i} style={{ display: "flex", gap: 10, padding: "5px 0", lineHeight: 1.55, color: "var(--soft)" }}>
                  <span style={{ width: 5, height: 5, flex: "none", borderRadius: "50%", background: "var(--acc)", marginTop: 8 }} />
                  <span>{inline(it)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ padding: "8px 24px 20px", display: "flex", justifyContent: "flex-end" }}>
          <button className="btn" onClick={close} style={{ height: 32, padding: "0 18px" }}>Got it</button>
        </div>
      </div>
    </>
  );
}
