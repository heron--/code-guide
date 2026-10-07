import { useCallback, useEffect, useState } from "react";

const CHANGED = "cg-storage";
/**
 * Every value this page writes, read first: it stays right when localStorage can't be used, or refuses a write
 * (e.g. it's full) while still returning the old value.
 */
const memory = new Map<string, string>();
const load = (key: string): string | null => {
  if (memory.has(key)) return memory.get(key)!;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
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
  const read = () => {
    try {
      const raw = load(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  };
  const [state, setValue] = useState<{ key: string; value: T }>(() => ({ key, value: read() }));
  // A new key (e.g. a revised guide) reads its own stored value instead of keeping the old key's.
  const value = state.key === key ? state.value : read();
  const set = useCallback(
    (v: T) => {
      setValue({ key, value: v });
      save(key, JSON.stringify(v));
    },
    [key],
  );
  return [value, set];
}
