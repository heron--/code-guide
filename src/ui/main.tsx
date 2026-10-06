import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "./components/ui/tooltip";
import { GuideList } from "./components/GuideList";
import { GuideView } from "./components/GuideView";
import { useRoute } from "./lib/router";
import "./index.css";

function App() {
  const route = useRoute();
  return (
    <TooltipProvider delayDuration={300}>
      {route.page === "home" ? <GuideList /> : <GuideView id={route.id} tab={route.tab} chapter={route.chapter} />}
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
