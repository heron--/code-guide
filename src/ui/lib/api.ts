import type { GuideSummary, Problem, ResolvedFile, ResolvedGuide } from "../../shared/guide";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok && res.status !== 422) throw new Error(body.error ?? res.statusText);
  return body;
}

export const api = {
  guides: () => get<{ roots: string[]; guides: GuideSummary[] }>("/api/guides"),
  guide: (id: string) =>
    get<ResolvedGuide | { id: string; file: string; problems: Problem[]; guide?: undefined }>(
      `/api/guides/${encodeURIComponent(id)}`,
    ),
  changedFile: (id: string, path: string) =>
    get<ResolvedFile>(`/api/guides/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}`),
};
