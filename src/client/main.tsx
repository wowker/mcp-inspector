import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@primer/primitives/dist/css/functional/themes/light.css";
import "@primer/primitives/dist/css/functional/themes/dark.css";
import "@primer/css/dist/core.css";
import { App } from "./app/App.js";
import { applyInitialTheme } from "./app/theme.js";

applyInitialTheme();

const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) {
  throw new Error("Missing application root");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
