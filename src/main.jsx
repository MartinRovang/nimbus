import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@phosphor-icons/web/regular";
import "./styles.css";
import Boot from "./Boot.jsx";
import { applySettings, settings } from "./settings.js";
import { loadPlugins } from "./plugins.js";

applySettings();
// a saved plugin theme can only be applied once its plugin has loaded
loadPlugins(settings.pluginsOff).then(applySettings);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Boot />
  </React.StrictMode>,
);
