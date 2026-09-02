import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@primer/primitives/dist/css/functional/themes/light.css";
import "@primer/primitives/dist/css/functional/themes/dark.css";
import "@primer/css/dist/base.css";
import { App } from "./app/App.js";
import { AppToaster } from "./app/AppToaster.js";
import { applyInitialTheme } from "./app/theme.js";
import { JsonDocumentPage } from "./features/runs/JsonDocumentPage.js";
import "./i18n/index.js";

applyInitialTheme();

const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) {
  throw new Error("Missing application root");
}

createRoot(root).render(
  <StrictMode>
    <AppToaster />
    {window.location.pathname === "/json-viewer" ? <JsonDocumentPage /> : <App />}
  </StrictMode>,
);
