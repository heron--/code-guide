import { useCallback, useEffect, useState } from "react";

/** A set of strings persisted in localStorage (e.g. reviewed chapters/files). */
export function usePersistentSet(key: string): [Set<string>, (item: string, on: boolean) => void] {
  const read = () => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem(key) ?? "[]"));
    } catch {
      return new Set<string>();
    }
  };
  const [set, setSet] = useState(read);
  useEffect(() => setSet(read()), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = useCallback(
    (item: string, on: boolean) =>
      setSet((prev) => {
        const next = new Set(prev);
        if (on) next.add(item);
        else next.delete(item);
        try {
          localStorage.setItem(key, JSON.stringify([...next]));
        } catch {
          /* storage unavailable: keep in memory */
        }
        return next;
      }),
    [key],
  );
  return [set, toggle];
}
