import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { useMyGroups } from "@/hooks/useMyGroups";
import type { MyGroupRow } from "@/types";

function fmtDate(d?: string | null) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return "";
  }
}

function useQuery() {
  const loc = useLocation();
  return useMemo(() => new URLSearchParams(loc.search), [loc.search]);
}

export default function GroupsPage() {
  const query = useQuery();

  const category = query.get("category") || "";
  const search = query.get("q") || "";

  const {
    me,
    groups,
    loading,
    err,
    hasMore,
    paging,
    unreadCounts,
    openPolls,
    loadMore,
    markGroupRead,
  } = useMyGroups({ category, search });

  const pageTitle = "My Groups";

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{pageTitle}</h1>
          {search && (
            <p className="text-sm text-neutral-600">Filtered by: “{search}”</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link to="/browse" className="text-sm underline">
            Back
          </Link>
          <Link
            to="/create"
            className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm text-white hover:brightness-110"
          >
            New Group
          </Link>
        </div>
      </div>

      {/* Results */}
      <div className="mt-6 rounded-2xl border border-black/10 bg-white/90 p-5 shadow-sm backdrop-blur">
        {loading && groups.length === 0 ? (
          <ul className="divide-y divide-black/5">
            {Array.from({ length: 6 }).map((_, i) => (
              <li
                key={i}
                className="rounded-xl border border-black/10 bg-white p-4 shadow-sm"
              >
                <div className="h-5 w-48 animate-pulse rounded bg-neutral-200" />
                <div className="mt-2 h-3 w-5/6 animate-pulse rounded bg-neutral-200" />
                <div className="mt-1 h-3 w-2/3 animate-pulse rounded bg-neutral-200" />
                <div className="mt-4 flex gap-2">
                  <div className="h-8 w-24 animate-pulse rounded bg-neutral-200" />
                  <div className="h-8 w-28 animate-pulse rounded bg-neutral-200" />
                </div>
              </li>
            ))}
          </ul>
        ) : err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
            {err}
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 p-10 text-center text-neutral-600">
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="opacity-70"
            >
              <path d="M8 21h8" />
              <path d="M12 17v4" />
              <path d="M7 3h10l4 7H3l4-7Z" />
            </svg>
            <div className="text-lg font-medium">No groups found</div>
            <div className="text-sm">Try a different filter or create a new one.</div>
            <div className="mt-2 flex justify-center gap-2">
              <Link
                to="/browse"
                className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04]"
              >
                Back
              </Link>
              <Link
                to="/create"
                className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm text-white hover:brightness-110"
              >
                New Group
              </Link>
            </div>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-black/5">
              {groups.map((g) => (
                <li key={g.id} className="group py-1 first:pt-0 last:pb-0">
                  <div className="flex items-center">
                    <Link
                      to={`/group/${g.id}`}
                      onClick={() => markGroupRead(g.id)}
                      className="block flex-1 rounded-lg px-2 py-2 hover:bg-black/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 select-none items-center justify-center rounded-full border border-black/10 bg-neutral-100 text-sm font-semibold text-neutral-700">
                          {(g.title || g.game || "G").slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div className="truncate text-base font-medium text-neutral-900">
                              {g.title ?? "Untitled group"}
                            </div>
                            {g.host_id && g.host_id === me && (
                              <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
                                Host
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 line-clamp-1 text-xs text-neutral-600">
                            {g.description ?? "No description"}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-neutral-700">
                            {g.category && (
                              <span className="rounded-full border border-black/10 bg-neutral-50 px-2 py-0.5">
                                #{g.category}
                              </span>
                            )}
                            {g.game && (
                              <span className="rounded-full border border-black/10 bg-neutral-50 px-2 py-0.5">
                                {g.game}
                              </span>
                            )}
                            {g.city && (
                              <span className="rounded-full border border-black/10 bg-neutral-50 px-2 py-0.5">
                                {g.city}
                              </span>
                            )}
                            {g.capacity && (
                              <span className="rounded-full border border-black/10 bg-neutral-50 px-2 py-0.5">
                                {g.capacity} slots
                              </span>
                            )}
                            {g.created_at && (
                              <span className="rounded-full border border-black/10 bg-neutral-50 px-2 py-0.5">
                                {fmtDate(g.created_at)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="ml-1 flex items-center gap-1">
                          {openPolls[g.id] && (
                            <span
                              className="inline-flex h-6 items-center justify-center rounded-full bg-blue-600 px-2 text-xs font-semibold text-white"
                              title="Open voting"
                              aria-label="Open voting"
                            >
                              Vote
                            </span>
                          )}
                          {typeof unreadCounts[g.id] === "number" && unreadCounts[g.id]! > 0 && (
                            <span
                              className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-emerald-600 px-1 text-xs font-semibold text-white"
                              title={`${unreadCounts[g.id]} new messages`}
                              aria-label={`${unreadCounts[g.id]} new messages`}
                            >
                              {unreadCounts[g.id] > 99 ? "99+" : unreadCounts[g.id]}
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                    {typeof unreadCounts[g.id] === "number" && unreadCounts[g.id]! > 0 && (
                      <button
                        onClick={(ev) => {
                          ev.preventDefault();
                          ev.stopPropagation();
                          markGroupRead(g.id);
                        }}
                        className="ml-2 shrink-0 rounded-md border border-black/10 bg-white px-2.5 py-1 text-xs hover:bg-black/[0.04]"
                        title="Mark as read"
                      >
                        Read
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {hasMore && (
              <div className="mt-5 border-t border-black/5 p-4 text-center">
                <button
                  onClick={loadMore}
                  className="inline-flex items-center gap-2 rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04]"
                  disabled={paging}
                >
                  {paging ? (
                    <>
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                        />
                      </svg>
                      Loading…
                    </>
                  ) : (
                    <>Load more</>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}