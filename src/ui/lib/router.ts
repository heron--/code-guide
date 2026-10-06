import { useEffect, useState } from "react";

export type Tab = "overview" | "guide" | "diff";
export type Route = { page: "home" } | { page: "guide"; id: string; tab: Tab; chapter: number };

/** Routes: #/  ·  #/g/<id>/<tab>/<chapter> (chapter is 1-based). */
export function parseHash(hash: string): Route {
  const [, g, id, tab, ch] = hash.replace(/^#/, "").split("/");
  if (g !== "g" || !id) return { page: "home" };
  const t: Tab = tab === "overview" || tab === "diff" ? tab : "guide";
  return { page: "guide", id: decodeURIComponent(id), tab: t, chapter: Math.max(0, Number(ch || 1) - 1) };
}

export function href(r: Route): string {
  return r.page === "home" ? "#/" : `#/g/${encodeURIComponent(r.id)}/${r.tab}/${r.chapter + 1}`;
}

export function navigate(r: Route, replace = false) {
  const h = href(r);
  if (replace) history.replaceState(null, "", h);
  else location.hash = h;
  if (replace) window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
