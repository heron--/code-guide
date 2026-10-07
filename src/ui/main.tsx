import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SessionHome } from "./components/SessionHome";
import { showTruncatedText } from "./lib/truncation";
import "./index.css";

showTruncatedText();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SessionHome />
  </StrictMode>,
);
