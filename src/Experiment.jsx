// An experiment project's results: where it stands, a chart of every try, and the log (results.tsv in the project folder).
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { I } from "./ui.jsx";
import { parseResults, resultStats, chartGeom } from "./lib.js";

const COLOR = { keep: "var(--add)", discard: "var(--dim)", crash: "var(--del)" };
const num = (v) => (v == null ? "" : String(+v.toPrecision(6)));

export function Experiment({ id, cfg, n }) {
  const [tsv, setTsv] = useState(null);
  useEffect(() => {
    let dead = false;
    invoke("read_file", { id, path: "results.tsv" }).then((t) => !dead && setTsv(t), () => !dead && setTsv(""));
    return () => { dead = true; };
  }, [id, n]);
  if (tsv == null) return <div style={{ color: "var(--dim)", display: "flex", gap: 8, alignItems: "center" }}><I n="ph-circle-notch spin" />Loading…</div>;
  const { rows, skipped } = parseResults(tsv), dir = cfg.experiment?.direction;
  if (!rows.length) return <div style={{ color: "var(--dim)" }}>No results yet: Claude records the baseline after its first run.{skipped > 0 && ` (${skipped} unreadable row${skipped > 1 ? "s" : ""} in results.tsv)`}</div>;
  const s = resultStats(rows, dir), { dots, path } = chartGeom(rows, s.frontier);
  const good = s.change != null && s.change !== 0 && (dir === "higher" ? s.change > 0 : s.change < 0);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", fontSize: 12.5, color: "var(--dim)" }}>
        <span className="mono" style={{ fontSize: 22, color: "var(--fg)" }}>{s.best == null ? "no kept run yet" : num(s.best)}</span>
        {s.change != null && s.change !== 0 && <span style={{ color: good ? "var(--add)" : "var(--del)" }}>{s.change > 0 ? "+" : ""}{s.change.toFixed(2)}% vs baseline {num(s.baseline)}</span>}
        <span className="spacer" />
        <span>{rows.length} run{rows.length > 1 ? "s" : ""}</span>
        <span style={{ color: COLOR.keep }}>{s.kept} kept</span>
        <span>{s.discarded} discarded</span>
        <span style={{ color: s.crashed ? COLOR.crash : undefined }}>{s.crashed} crashed</span>
        {skipped > 0 && <span title="Rows in results.tsv that aren't commit, metric, status, description">{skipped} unreadable</span>}
      </div>
      <svg viewBox="0 0 800 200" role="img" aria-label={`Metric per run, ${dir} is better`} style={{ display: "block", width: "100%", marginTop: 12, borderRadius: 10, boxShadow: "0 0 0 1px var(--border)" }}>
        <path d={path} fill="none" stroke={COLOR.keep} strokeWidth="1.5" />
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={d.status === "keep" ? 4 : 3} fill={d.status === "discard" ? "none" : COLOR[d.status]} stroke={COLOR[d.status]} strokeWidth="1.2">
            <title>{`${rows[i].commit} · ${rows[i].status}${rows[i].metric == null ? "" : " · " + num(rows[i].metric)}\n${rows[i].description}`}</title>
          </circle>
        ))}
      </svg>
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "auto auto auto 1fr", columnGap: 16, rowGap: 6, fontSize: 12.5, alignItems: "baseline" }}>
        {rows.map((r, i) => [
          <span key={i + "c"} className="mono" style={{ fontSize: 11.5, color: "var(--dimmer)" }}>{r.commit}</span>,
          <span key={i + "m"} className="mono" style={{ textAlign: "right", color: "var(--soft)" }}>{num(r.metric)}</span>,
          <span key={i + "s"} style={{ color: COLOR[r.status] }}>{r.status}</span>,
          <span key={i + "d"} style={{ color: r.status === "keep" ? "var(--soft)" : "var(--dim)" }}>{r.description}</span>,
        ]).reverse()}
      </div>
    </div>
  );
}
