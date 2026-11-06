/** Entry point: mounts the app inside the state provider. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AppEntry from "./AppEntry";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppEntry />
  </StrictMode>
);
