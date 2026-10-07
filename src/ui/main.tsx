import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SessionHome } from "./components/SessionHome";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SessionHome />
  </StrictMode>,
);
