import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@phosphor-icons/web/regular";
import "./styles.css";
import Boot from "./Boot.jsx";
import TermWindow from "./TermWindow.jsx";
import ProjectWindow from "./ProjectWindow.jsx";
import { applySettings, settings } from "./settings.js";
import { loadPlugins } from "./plugins.js";

applySettings();
// a saved plugin theme can only be applied once its plugin has loaded
loadPlugins(settings.pluginsOff).then(applySettings);

// the dual-screen terminals window and a popped-out project tab skip the update check and the app shell
const q = new URLSearchParams(location.search), view = q.get("view");
const root = view === "terms" ? <TermWindow /> : view === "project" ? <ProjectWindow id={q.get("project")} tab={q.get("tab")} /> : <Boot />;

// the main window starts with no shells: a reload restarts tab ids, which must not re-attach to the old page's shells
(view ? Promise.resolve() : invoke("pty_reset").catch(() => {})).then(() => ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {root}
  </React.StrictMode>,
));
