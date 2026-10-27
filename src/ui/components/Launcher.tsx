import { QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  parsePullRequestLink,
  type DirectoryListing,
  type HistoryItem,
  type LauncherState,
  type Page,
  type PullRequestChoice,
  type Repository,
  type Selection,
} from "../../shared/launcher";

const inputClass = "w-full border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none";
const buttonClass =
  "border border-border px-3 py-2 text-sm hover:border-accent aria-pressed:border-accent aria-pressed:bg-accent-bg disabled:opacity-50";

const tabClass =
  "-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-fg-2 hover:text-fg aria-selected:border-accent aria-selected:font-medium aria-selected:text-fg disabled:opacity-50";
const level1Class = "text-lg font-semibold";
const level2Class = "text-base font-semibold";

export async function launcherRequest<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(
    `/api/${path}`,
    body === undefined
      ? { signal }
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal,
        },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Request failed");
  return result;
}

/**
 * The launcher's answers, kept by path. GitHub's are kept five minutes, so going back to a page, repository or
 * filter shows it at once; Refresh GitHub asks again.
 */
export const launcherQueries = () =>
  new QueryClient({
    defaultOptions: { queries: { staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false } },
  });

/** How long typing pauses before what was typed is fetched. */
export const TYPING_PAUSE = 300;

/** `value`, once it has stopped changing for `TYPING_PAUSE`. */
function useSettled<T>(value: T): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), TYPING_PAUSE);
    return () => clearTimeout(timer);
  }, [value]);
  return settled;
}

/**
 * Fetch `path`; undefined fetches nothing. When `path` changes, the request for the old one is cancelled, and the
 * launcher stops its gh calls. `loading` is true until a result or error arrives. GitHub's answers are kept per
 * `account`, so signing in as someone else never shows the last account's.
 */
function useChoices<T>(path: string | undefined, options: { fresh?: boolean; account?: string } = {}) {
  const query = useQuery({
    queryKey: options.account ? [path, options.account] : [path],
    queryFn: ({ signal }) => launcherRequest<T>(path!, undefined, signal),
    enabled: path !== undefined,
    ...(options.fresh && { staleTime: 0 }),
  });
  return { data: query.data, error: query.error?.message, loading: path !== undefined && query.isPending };
}

/** A page number that goes back to 1 whenever `key` (what is being paged) changes. */
function usePage(key: string) {
  const [state, setState] = useState({ key, page: 1 });
  return [state.key === key ? state.page : 1, (page: number) => setState({ key, page })] as const;
}

function Pager({
  label,
  page,
  setPage,
  hasMore,
}: {
  label: string;
  page: number;
  setPage: (page: number) => void;
  hasMore?: boolean;
}) {
  if (page === 1 && !hasMore) return null;
  return (
    <nav aria-label={label} className="flex items-center gap-2 text-sm">
      <button type="button" className={buttonClass} disabled={page === 1} onClick={() => setPage(page - 1)}>
        Previous
      </button>
      <span className="text-fg-3">Page {page}</span>
      <button type="button" className={buttonClass} disabled={!hasMore} onClick={() => setPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}

export function Launcher({
  initial,
  refresh,
}: {
  initial: LauncherState & { sessionUrl?: string };
  /** Asks the launcher for its state, which checks GitHub's authentication again. */
  refresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState<"pr" | "local" | "history">("pr");
  const [prLink, setPrLink] = useState("");
  const [repoSearch, setRepoSearch] = useState("");
  const [onlyMine, setOnlyMine] = useState(true);
  const [repo, setRepo] = useState("");
  const [search, setSearch] = useState("");
  const [author, setAuthor] = useState("me");
  const [state, setState] = useState("all");
  const [localPath, setLocalPath] = useState(initial.localPath);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [settings, setSettings] = useState(false);
  const [selected, setSelected] = useState<number>();
  const [keepClones, setKeepClones] = useState(initial.keepClones);
  useEffect(() => setKeepClones(initial.keepClones), [initial.keepClones]);
  const auth = initial.github;
  const queries = useQueryClient();
  // History and the running session change outside the launcher's requests, so they're asked again on refresh.
  useEffect(() => void queries.invalidateQueries({ queryKey: ["history"] }), [initial]);
  const github = tab === "pr" && auth.ok;
  const account = { account: auth.ok ? `${auth.host}/${auth.login}` : undefined };
  // Your repositories, a page at a time. Partial names match the page shown at once; GitHub's search adds the
  // rest: all of GitHub, or all of your repositories.
  const [minePage, setMinePage] = usePage("mine");
  const mine = useChoices<Page<Repository>>(github ? `repositories?page=${minePage}` : undefined, account);
  const typed = repoSearch.trim();
  const query = useSettled(typed);
  const [foundPage, setFoundPage] = usePage(`${query} ${onlyMine}`);
  const found = useChoices<Page<Repository>>(
    github && query
      ? `repositories/search?${new URLSearchParams({ q: query, scope: onlyMine ? "mine" : "all", page: String(foundPage) })}`
      : undefined,
    account,
  );
  const searching = !!typed;
  const matches = (mine.data?.items ?? []).filter((r) => r.name.toLowerCase().includes(typed.toLowerCase()));
  const shownRepositories = !searching
    ? (mine.data?.items ?? [])
    : [
        ...new Map(
          [...(foundPage === 1 ? matches : []), ...(found.data?.items ?? [])].map((r) => [r.name.toLowerCase(), r]),
        ).values(),
      ];
  const searchPending = searching && (query !== typed || found.loading);
  const history = useChoices<HistoryItem[]>(tab === "history" ? "history" : undefined, { fresh: true });
  const prSearch = useSettled(search);
  const prAuthor = useSettled(author);
  const prFilters = { repo, search: prSearch, author: prAuthor, state };
  const [prPage, setPrPage] = usePage(JSON.stringify(prFilters));
  const prs = useChoices<Page<PullRequestChoice>>(
    github && repo ? `pull-requests?${new URLSearchParams({ ...prFilters, page: String(prPage) })}` : undefined,
    account,
  );
  // Until typing settles, the PRs shown are for the old filters.
  const prsSettled = prSearch === search && prAuthor === author;
  const authors = useChoices<string[]>(
    github && repo ? `authors?${new URLSearchParams({ repo })}` : undefined,
    account,
  );
  const settledPath = useSettled(localPath);
  const listing = useChoices<DirectoryListing>(
    tab === "local" ? `directories?${new URLSearchParams({ path: settledPath })}` : undefined,
    { fresh: true },
  );
  // A selection only stands while its PR is in the list shown, so not while typing changes the filters.
  useEffect(() => {
    if (selected !== undefined && (!prsSettled || !prs.data?.items.some((pr) => pr.number === selected)))
      setSelected(undefined);
  }, [prs.data, prsSettled, selected]);
  // Suggested authors: the repository's contributors, and anyone whose PRs have been listed.
  const [seen, setSeen] = useState<Record<string, string[]>>({});
  useEffect(() => {
    const logins = prs.data?.items.flatMap((pr) => (pr.author ? [pr.author.login] : []));
    if (logins?.length) setSeen((s) => ({ ...s, [repo]: [...new Set([...(s[repo] ?? []), ...logins])] }));
  }, [prs.data, repo]);
  const suggestedAuthors = [...new Set(["me", ...(authors.data ?? []), ...(seen[repo] ?? [])])];

  const start = async (selection: Selection) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await launcherRequest<{ url: string }>("start", selection);
      window.location.assign(result.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-auto bg-canvas px-4 py-10 text-fg">
      <main className="mx-auto max-w-3xl border border-rule bg-surface shadow-active">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-surface-3 px-5 py-3">
          <h1 className="text-xl font-semibold">Code Guide</h1>
          <button
            className={buttonClass}
            onClick={() => {
              setSettings(!settings);
              refresh();
            }}
          >
            Settings
          </button>
        </header>
        <div className="flex flex-col gap-5 p-5">
          <div className="flex flex-wrap items-center gap-3 text-sm" role="status">
            <span className={auth.ok ? "text-fg-2" : "text-del"}>
              {auth.ok ? `GitHub · ${auth.login} · authenticated on ${auth.host}` : auth.error}
            </span>
            <button
              className={buttonClass}
              // After authentication is checked again, so no answer is for an account that has since changed.
              onClick={() => void refresh().then(() => queries.invalidateQueries())}
            >
              Refresh GitHub
            </button>
          </div>
          {settings && (
            <div className="border border-rule p-3">
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={keepClones}
                  onChange={async (event) => {
                    const value = event.target.checked;
                    try {
                      await launcherRequest("settings", { keepClones: value });
                      setKeepClones(value);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                />
                Keep PR checkouts after sessions end
              </label>
              <p className="mt-2 text-xs text-fg-3">
                Saved in ~/.code-guide/settings.json. Also editable in the console: press s.
              </p>
            </div>
          )}
          {initial.sessionUrl && (
            <a className="text-accent underline" href={initial.sessionUrl}>
              Return to running session
            </a>
          )}
          {error && (
            <p role="alert" className="text-sm text-del">
              {error}
            </p>
          )}
          {busy && (
            <p role="status" className="text-sm text-fg-2">
              {tab === "pr"
                ? "Preparing shallow checkout and starting session…"
                : "Checking repository and starting session…"}
            </p>
          )}
          <div role="tablist" aria-label="Launcher sections" className="-mx-5 flex gap-1 border-b border-rule px-5">
            {(
              [
                ["pr", "Pull requests"],
                ["local", "Local"],
                ["history", "Session history"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                role="tab"
                id={`tab-${value}`}
                aria-selected={tab === value}
                aria-controls="launcher-panel"
                className={tabClass}
                disabled={busy}
                onClick={() => {
                  setTab(value);
                  setError(undefined);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id="launcher-panel" aria-labelledby={`tab-${tab}`} className="flex min-w-0 flex-col">
            {tab === "history" ? (
              <SessionHistory history={history} />
            ) : (
              <fieldset
                disabled={busy || !!initial.sessionUrl}
                className="flex min-w-0 flex-col gap-4 disabled:opacity-60"
              >
                {tab === "pr" ? (
                  <>
                    <section className="flex flex-col gap-3" aria-labelledby="pr-link-heading">
                      <h2 id="pr-link-heading" className={level1Class}>
                        Paste a PR link
                      </h2>
                      <PullRequestLinkForm
                        value={prLink}
                        setValue={setPrLink}
                        auth={auth}
                        start={(pr) => void start({ mode: "pr", ...pr })}
                      />
                    </section>
                    <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-fg-3">
                      <span className="h-px flex-1 bg-border" />
                      or
                      <span className="h-px flex-1 bg-border" />
                    </div>
                    <section className="flex flex-col gap-4" aria-labelledby="browse-heading">
                      <h2 id="browse-heading" className={level1Class}>
                        Browse
                      </h2>
                      <h3 className={level2Class}>Select a repo</h3>
                      <form
                        className="flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          setRepo(repoSearch.trim());
                        }}
                      >
                        <input
                          aria-label="Repository search"
                          className={inputClass}
                          value={repoSearch}
                          onChange={(e) => setRepoSearch(e.target.value)}
                          placeholder="Search or enter owner/repository"
                          disabled={!auth.ok}
                        />
                        <button
                          className={`${buttonClass} shrink-0`}
                          disabled={!auth.ok || !/^[\w.-]+\/[\w.-]+$/.test(repoSearch.trim())}
                        >
                          Use repository
                        </button>
                      </form>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={onlyMine}
                          disabled={!auth.ok}
                          onChange={(e) => setOnlyMine(e.target.checked)}
                        />
                        Only my repositories
                        <span className="text-xs text-fg-3">yours, and your organizations&apos;</span>
                      </label>
                      {(mine.error || (searching && found.error)) && (
                        <p role="alert" className="text-sm text-del">
                          {mine.error ?? found.error}
                        </p>
                      )}
                      {(mine.loading || searchPending) && (
                        <p role="status" className="flex items-center gap-1.5 text-sm text-fg-2">
                          <span className="size-1.5 animate-pulse bg-accent" />
                          {mine.loading
                            ? "Loading your repositories…"
                            : onlyMine
                              ? "Searching your repositories on GitHub…"
                              : "Searching GitHub…"}
                        </p>
                      )}
                      {searching && !searchPending && !mine.loading && shownRepositories.length === 0 && (
                        <p className="text-sm text-fg-3">No matching repositories.</p>
                      )}
                      <div className="flex max-h-40 flex-col gap-1 overflow-auto" aria-label="Repositories">
                        {shownRepositories.map((r) => (
                          <button
                            key={r.name}
                            className={`${buttonClass} text-left`}
                            aria-pressed={repo === r.name}
                            onClick={() => setRepo(r.name)}
                          >
                            {r.name}
                            {r.recent ? " · recent" : ""}
                          </button>
                        ))}
                      </div>
                      {searching ? (
                        <Pager
                          label="Repository pages"
                          page={foundPage}
                          setPage={setFoundPage}
                          hasMore={found.data?.hasMore}
                        />
                      ) : (
                        <Pager
                          label="Repository pages"
                          page={minePage}
                          setPage={setMinePage}
                          hasMore={mine.data?.hasMore}
                        />
                      )}
                      {repo && auth.ok && (
                        <>
                          <h3 className={level2Class}>
                            Select a PR <span className="font-normal text-fg-3">· {repo}</span>
                          </h3>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <label className="text-sm">
                              Search PRs
                              <input
                                className={inputClass}
                                value={search}
                                onChange={(e) => {
                                  // A link to another repository's PR moves to that repository.
                                  const other = parsePullRequestLink(e.target.value);
                                  if (other && auth.ok && other.host === auth.host.toLowerCase()) setRepo(other.repo);
                                  setSearch(e.target.value);
                                }}
                                placeholder="Title, number, link, or GitHub query"
                              />
                            </label>
                            <label className="text-sm">
                              Author
                              <input
                                className={inputClass}
                                value={author}
                                list="pr-authors"
                                autoComplete="off"
                                onChange={(e) => setAuthor(e.target.value)}
                                placeholder="Any author"
                              />
                              <datalist id="pr-authors">
                                {suggestedAuthors.map((login) => (
                                  <option key={login} value={login} />
                                ))}
                              </datalist>
                            </label>
                            <label className="text-sm">
                              State
                              <select className={inputClass} value={state} onChange={(e) => setState(e.target.value)}>
                                <option value="all">All</option>
                                <option value="open">Open</option>
                                <option value="closed">Closed</option>
                                <option value="merged">Merged</option>
                              </select>
                            </label>
                          </div>
                          <p className="text-xs text-fg-3">
                            Author: me uses your authenticated account; clear for anyone. A PR number or link finds that
                            PR, whatever the filters.
                          </p>
                          {prs.error ? (
                            <p role="alert" className="text-sm text-del">
                              {prs.error}
                            </p>
                          ) : !prs.data || !prsSettled ? (
                            <p role="status">Loading PRs…</p>
                          ) : prs.data.items.length === 0 ? (
                            <p>No matching PRs.</p>
                          ) : (
                            <ul className="flex max-h-72 flex-col gap-1 overflow-auto" aria-label="Pull requests">
                              {prs.data.items.map((pr) => (
                                <li key={pr.number}>
                                  <button
                                    className={`${buttonClass} w-full text-left`}
                                    aria-pressed={selected === pr.number}
                                    onClick={() => setSelected(pr.number)}
                                    onDoubleClick={() => void start({ mode: "pr", repo, number: pr.number })}
                                  >
                                    <span className="block font-medium">
                                      #{pr.number} {pr.title}
                                    </span>
                                    <span className="text-xs text-fg-3">
                                      {pr.state.toLowerCase()} · {pr.author?.login ?? "unknown author"}
                                      {pr.isDraft ? " · draft" : ""}
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                          {prsSettled && (
                            <Pager label="PR pages" page={prPage} setPage={setPrPage} hasMore={prs.data?.hasMore} />
                          )}
                          <button
                            className={`${buttonClass} self-end`}
                            disabled={selected === undefined}
                            onClick={() => selected !== undefined && void start({ mode: "pr", repo, number: selected })}
                          >
                            Start session
                          </button>
                        </>
                      )}
                    </section>
                  </>
                ) : (
                  <form
                    className="flex flex-col gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void start({ mode: "local", path: localPath, inputs: { source, target, question } });
                    }}
                  >
                    <label className="text-sm">
                      Directory
                      <input
                        className={inputClass}
                        required
                        value={localPath}
                        onChange={(e) => setLocalPath(e.target.value)}
                      />
                    </label>
                    <FileBrowser listing={listing} open={setLocalPath} />
                    <label className="text-sm">
                      Source branch (optional)
                      <input
                        className={inputClass}
                        value={source}
                        onChange={(e) => {
                          setSource(e.target.value);
                          if (!e.target.value.trim()) setTarget("");
                        }}
                        placeholder="feature or origin/feature"
                      />
                    </label>
                    {source.trim() && (
                      <label className="text-sm">
                        Target branch (optional)
                        <input
                          className={inputClass}
                          value={target}
                          onChange={(e) => setTarget(e.target.value)}
                          placeholder="Default branch"
                        />
                      </label>
                    )}
                    <label className="text-sm">
                      Question or path (optional)
                      <input
                        className={inputClass}
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        placeholder="How are retries scheduled?"
                      />
                    </label>
                    <p className="text-xs text-fg-3">
                      Leave the subject blank to explain the repository. The session uses this checkout as it is; GitHub
                      authentication is not required.
                    </p>
                    <button type="submit" className={`${buttonClass} self-end`} disabled={!listing.data?.repository}>
                      Start session
                    </button>
                  </form>
                )}
              </fieldset>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/** Starts the PR a pasted link names. The link must be for the host the GitHub CLI is signed in to. */
function PullRequestLinkForm({
  value,
  setValue,
  auth,
  start,
}: {
  value: string;
  setValue: (value: string) => void;
  auth: LauncherState["github"];
  start: (pr: { repo: string; number: number }) => void;
}) {
  const host = auth.ok ? auth.host : "github.com";
  const link = parsePullRequestLink(value);
  const usable = link && auth.ok && link.host === auth.host.toLowerCase() ? link : undefined;
  const problem = !value.trim()
    ? undefined
    : !link
      ? `Use a link like https://${host}/owner/repository/pull/123.`
      : !usable && auth.ok
        ? `This link is for ${link.host}; the GitHub CLI is signed in to ${auth.host}.`
        : undefined;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (usable) start({ repo: usable.repo, number: usable.number });
      }}
    >
      <div className="flex gap-2">
        <input
          aria-label="PR link"
          className={inputClass}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`https://${host}/owner/repository/pull/123`}
          disabled={!auth.ok}
        />
        <button className={`${buttonClass} shrink-0`} disabled={!usable}>
          {usable ? `Start session on ${usable.repo}#${usable.number}` : "Start session"}
        </button>
      </div>
      {problem ? (
        <p className="text-sm text-del">{problem}</p>
      ) : (
        <p className="text-xs text-fg-3">Code Guide reads the repository and PR number from the link.</p>
      )}
    </form>
  );
}

/** The Local file browser: directories open on click; files are shown, but can't be chosen. */
function FileBrowser({
  listing,
  open,
}: {
  listing: { data?: DirectoryListing; error?: string };
  open: (path: string) => void;
}) {
  if (listing.error)
    return (
      <p role="alert" className="text-sm text-del">
        {listing.error}
      </p>
    );
  const dir = listing.data;
  if (!dir) return <p className="text-sm text-fg-3">Reading directory…</p>;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-fg-3" role="status">
        {dir.repository
          ? `In git repository ${dir.repository}`
          : "Not in a git repository. Open one to start a session."}
      </p>
      <ul className="flex max-h-64 flex-col overflow-auto border border-border" aria-label="Files">
        {dir.parent && (
          <li>
            <button
              type="button"
              className="w-full px-3 py-1 text-left text-sm hover:bg-accent-bg"
              onClick={() => open(dir.parent!)}
            >
              ../
            </button>
          </li>
        )}
        {dir.entries.map((e) => (
          <li key={e.name}>
            {e.directory ? (
              <button
                type="button"
                className="w-full px-3 py-1 text-left text-sm hover:bg-accent-bg"
                onClick={() => open(e.path)}
              >
                {e.name}/
              </button>
            ) : (
              <span aria-disabled="true" className="block cursor-default px-3 py-1 text-sm text-fg-4">
                {e.name}
              </span>
            )}
          </li>
        ))}
        {dir.entries.length === 0 && <li className="px-3 py-1 text-sm text-fg-3">Empty directory</li>}
      </ul>
      {dir.truncated && <p className="text-xs text-fg-3">Showing the first {dir.entries.length} entries.</p>}
    </div>
  );
}

/** Past sessions, newest first, with whether each PR checkout was kept and is still on disk. */
function SessionHistory({ history }: { history: { data?: HistoryItem[]; error?: string } }) {
  if (history.error)
    return (
      <p role="alert" className="text-sm text-del">
        {history.error}
      </p>
    );
  if (!history.data) return <p className="text-sm text-fg-3">Loading session history…</p>;
  if (!history.data.length) return <p className="text-sm text-fg-3">No sessions yet.</p>;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">Session history</h2>
      <ul className="flex max-h-[32rem] flex-col gap-1 overflow-auto" aria-label="Session history">
        {history.data.map((h) => (
          <li key={h.id} className="flex flex-wrap items-baseline gap-x-3 border border-border px-3 py-2 text-sm">
            <span className="font-medium">{h.label}</span>
            <span className="text-xs text-fg-3">{new Date(h.startedAt).toLocaleString()}</span>
            <span className="ml-auto text-xs text-fg-2">{historyText(h)}</span>
            {h.mode === "pr" && h.exists && (
              <span className="w-full truncate font-mono text-xs text-fg-3" title={h.checkout}>
                {h.checkout}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function historyText(h: HistoryItem): string {
  if (h.running) return "Running";
  if (h.mode === "local") return h.endedAt ? "Local · ended" : "Local · ended unexpectedly";
  if (!h.endedAt) return h.exists ? "Ended unexpectedly · checkout still there" : "Ended unexpectedly · checkout gone";
  if (!h.kept) return "Checkout discarded";
  return h.exists ? "Checkout kept · still there" : "Checkout kept · since removed";
}
