import { useCallback, useEffect, useState } from "react";

const CHANGED = "cg-storage";
/** Where values live when localStorage can't be used (e.g. blocked by the browser): this page only. */
const memory = new Map<string, string>();
const load = (key: string): string | null => {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
};
const save = (key: string, value: string) => {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* kept in memory */
  }
};

/** A set of strings persisted in localStorage (e.g. reviewed chapters/files), shared live across components. */
export function usePersistentSet(key: string): [Set<string>, (item: string, on: boolean) => void] {
  const read = useCallback(() => {
    try {
      return new Set<string>(JSON.parse(load(key) ?? "[]"));
    } catch {
      return new Set<string>();
    }
  }, [key]);
  const [set, setSet] = useState(read);
  useEffect(() => {
    setSet(read());
    const on = (e: Event) => (e as CustomEvent<string>).detail === key && setSet(read());
    window.addEventListener(CHANGED, on);
    return () => window.removeEventListener(CHANGED, on);
  }, [key, read]);
  const toggle = useCallback(
    (item: string, on: boolean) => {
      const next = read();
      if (on) next.add(item);
      else next.delete(item);
      save(key, JSON.stringify([...next]));
      setSet(next);
      window.dispatchEvent(new CustomEvent(CHANGED, { detail: key }));
    },
    [key, read],
  );
  return [set, toggle];
}

/** A JSON value persisted in localStorage. */
export function usePersistent<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = load(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      save(key, JSON.stringify(v));
    },
    [key],
  );
  return [value, set];
}
