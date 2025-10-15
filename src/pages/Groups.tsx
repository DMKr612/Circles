import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

type GroupRow = {
  id: string;
  title: string | null;
  description?: string | null;
  city?: string | null;
  capacity?: number | null;
  category?: string | null; // e.g., "Games" | "Study" | "Outdoors"
  game?: string | null;     // e.g., "Hokm"
  created_at?: string | null;
  host_id?: string | null;
};
function fmtDate(d?: string | null) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString(); } catch { return ''; }
}

function useQuery() {
  const loc = useLocation();
  return useMemo(() => new URLSearchParams(loc.search), [loc.search]);
}

export default function GroupsPage() {
  const navigate = useNavigate();
  const query = useQuery();

  // querystring filters
  const category = query.get("category") || "";   // e.g. "Games" or leaf like "Hokm"
  const search = query.get("q") || "";            // text search
  const modeJoined = query.get("joined") === "1";  // /groups?joined=1
  const modeCreated = query.get("created") === "1"; // /groups?created=1
  const HIGH_LEVEL = new Set(["games", "study", "outdoors"]);

  const [me, setMe] = useState<string | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // pagination
  const PAGE_SIZE = 12;
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [paging, setPaging] = useState(false);

  // map: group_id -> has open poll
  const [openPolls, setOpenPolls] = useState<Record<string, boolean>>({});

  // map: group_id -> unread message count for me
const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  // whitelist: category (lowercase) -> allowed game slugs
  const [allowedByCat, setAllowedByCat] = useState<Record<string, string[]>>({});

  // load whitelist once
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await supabase
        .from("allowed_games")
        .select("id, category")
        .eq("is_active", true);
      if (!mounted) return;
      if (error) { setAllowedByCat({}); return; }
      const map: Record<string, string[]> = {};
      (data ?? []).forEach((r: any) => {
        const cat = String(r.category || "").toLowerCase();
        const id = String(r.id || "").toLowerCase();
        if (!cat || !id) return;
        if (!map[cat]) map[cat] = [];
        map[cat].push(id);
      });
      setAllowedByCat(map);
    })();
    return () => { mounted = false; };
  }, []);

  // Load current user id (for joining / created filters)
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setMe(data.user?.id ?? null);
    })();
  }, []);

  // Fetch groups whenever filters change
  useEffect(() => {
    let mounted = true;

    const applyCommonFilters = (q: any) => {
      let queryBuilder = q;
      const catLower = category ? category.toLowerCase() : "";
      const HIGH_LEVEL = new Set(["games", "study", "outdoors"]);

      if (catLower) {
        if (HIGH_LEVEL.has(catLower)) {
          const ids = allowedByCat[catLower] ?? [];
          if (ids.length > 0) {
            const inList = ids.map((s) => `"${s}"`).join(",");
            queryBuilder = queryBuilder.or(`game.in.(${inList}),category.eq.${catLower}`);
          } else {
            queryBuilder = queryBuilder.eq("category", catLower);
          }
        } else {
          const leaf = catLower.replace(/[^a-z0-9]+/g, "");
          queryBuilder = queryBuilder.or(`game.eq.${leaf},game.ilike.%${catLower}%,title.ilike.%${catLower}%`);
        }
      }
      if (search.trim()) {
        const q = search.trim();
        queryBuilder = queryBuilder.or(`title.ilike.%${q}%,game.ilike.%${q}%`);
      }
      return queryBuilder;
    };

    async function loadPage(reset: boolean) {
      try {
        if (reset) {
          setLoading(true);
          setGroups([]);
          setPage(0);
          setHasMore(false);
        } else {
          setPaging(true);
        }
        setErr(null);

        // auth guard for joined/created views
        if ((modeJoined || modeCreated) && !me) {
          setGroups([]);
          setErr("Please sign in to view your groups.");
          setLoading(false);
          setPaging(false);
          return;
        }

        let rows: GroupRow[] = [];
        const from = (reset ? 0 : (page + 1) * PAGE_SIZE) + 0; // next page start
        const to = from + PAGE_SIZE - 1;

        if (modeCreated && me) {
          let q = supabase
            .from("groups")
            .select("id, title, description, city, capacity, category, game, created_at, host_id")
            .eq("host_id", me)
            .order("created_at", { ascending: false })
            .range(from, to);
          const { data, error } = await applyCommonFilters(q);
          if (error) throw error;
          rows = (data ?? []) as GroupRow[];
        } else if (modeJoined && me) {
          const { data: mem, error: memErr } = await supabase
            .from("group_members")
            .select("group_id")
            .eq("user_id", me);
          if (memErr) throw memErr;
          const ids = (mem ?? []).map((m: any) => m.group_id);
          if (ids.length > 0) {
            let q = supabase
              .from("groups")
              .select("id, title, description, city, capacity, category, game, created_at, host_id")
              .in("id", ids)
              .order("created_at", { ascending: false })
              .range(from, to);
            const { data, error } = await applyCommonFilters(q);
            if (error) throw error;
            rows = (data ?? []) as GroupRow[];
          } else {
            rows = [];
          }
        } else {
          let q = supabase
            .from("groups")
            .select("id, title, description, city, capacity, category, game, created_at, host_id")
            .order("created_at", { ascending: false })
            .range(from, to);
          const { data, error } = await applyCommonFilters(q);
          if (error) throw error;
          rows = (data ?? []) as GroupRow[];
        }

        if (!mounted) return;
        if (reset) {
          setGroups(rows);
        } else {
          setGroups(prev => [...prev, ...rows]);
          setPage(p => p + 1);
        }
        setHasMore(rows.length === PAGE_SIZE);

        // open polls map for the page
        if ((rows ?? []).length > 0) {
          const ids = rows.map((g: GroupRow) => g.id);
          // unread badge counts for the page
          if (me && ids.length > 0) {
            await refreshUnreadCounts(ids);
          }
          const { data: polls } = await supabase
            .from("group_polls")
            .select("group_id")
            .in("group_id", ids)
            .eq("status", "open");
          const map: Record<string, boolean> = {};
          (polls ?? []).forEach((p: any) => { map[p.group_id] = true; });
          setOpenPolls(prev => ({ ...prev, ...map }));
        }
        
      } catch (e: any) {
        if (!mounted) return;
        setErr(e?.message ?? "Failed to load groups");
      } finally {
        if (!mounted) return;
        setLoading(false);
        setPaging(false);
      }
    }

    // initial or filters change -> reset paging and load first page
    loadPage(true);

    return () => { mounted = false; };
  }, [category, search, modeJoined, modeCreated, me, allowedByCat]);

  async function handleJoin(groupId: string) {
  if (!me) {
    alert("Please sign in to join groups.");
    return;
  }
  const { error } = await supabase
    .from("group_members")
    .insert({ group_id: groupId, user_id: me }); // let defaults set status/role
  // ignore unique violation (already a member)
  if (error && error.code !== "23505") {
    alert(error.message);
    return;
  }
  navigate(`/group/${groupId}`);
}

  async function createPollFor(groupId: string) {
    if (!me) { alert("Please sign in."); return; }
    const g = groups.find(x => x.id === groupId);
    if (!g) return;
    if (g.host_id !== me) { alert("Only the host can create a poll."); return; }
    const { data, error } = await supabase
      .from("group_polls")
      .insert({ group_id: groupId, title: "Schedule", created_by: me })
      .select("id")
      .single();
    if (error) { alert(error.message); return; }
    setOpenPolls(prev => ({ ...prev, [groupId]: true }));
    navigate(`/group/${groupId}#polls`);
  }

  async function refreshUnreadCounts(ids: string[]) {
  try {
    if (!me || !ids.length) return;

    // 1) last read per group for me
    const { data: reads, error: rErr } = await supabase
      .from('group_reads')
      .select('group_id,last_read_at')
      .eq('user_id', me)
      .in('group_id', ids);
    if (rErr) throw rErr;

    const lastByGroup: Record<string, string | null> = {};
    (reads ?? []).forEach((r: any) => { lastByGroup[r.group_id] = r.last_read_at ?? null; });

    // 2) count unread per group (simple per-group head count)
    const pairs = ids.map(async (gid) => {
      const last = lastByGroup[gid] ?? '1970-01-01T00:00:00Z';
      const { count, error } = await supabase
        .from('group_messages')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', gid)
        .gt('created_at', last);
      if (error) return [gid, 0] as const;
      return [gid, count ?? 0] as const;
    });

    const results = await Promise.all(pairs);
    const map: Record<string, number> = {};
    results.forEach(([gid, c]) => { map[gid] = c; });
    setUnreadCounts(prev => ({ ...prev, ...map }));
  } catch {
    // ignore; badge just won't show
  }
}



  async function loadMore() {
  try {
    setPaging(true);
    const from = (page + 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    let rows: GroupRow[] = [];

    const apply = (qb: any) => {
      let b = qb;
      const catLower = category ? category.toLowerCase() : '';
      const HIGH_LEVEL = new Set(['games','study','outdoors']);
      if (catLower) {
        if (HIGH_LEVEL.has(catLower)) {
          const ids = allowedByCat[catLower] ?? [];
          if (ids.length > 0) {
            const inList = ids.map((s) => `"${s}"`).join(',');
            b = b.or(`game.in.(${inList}),category.eq.${catLower}`);
          } else {
            b = b.eq('category', catLower);
          }
        } else {
          const leaf = catLower.replace(/[^a-z0-9]+/g, '');
          b = b.or(`game.eq.${leaf},game.ilike.%${catLower}%,title.ilike.%${catLower}%`);
        }
      }
      if (search.trim()) {
        const q = search.trim();
        b = b.or(`title.ilike.%${q}%,game.ilike.%${q}%`);
      }
      return b;
    };

    if (modeCreated && me) {
      let q = supabase
        .from('groups')
        .select('id, title, description, city, capacity, category, game, created_at, host_id')
        .eq('host_id', me)
        .order('created_at', { ascending: false })
        .range(from, to);
      const { data, error } = await apply(q);
      if (error) throw error;
      rows = (data ?? []) as GroupRow[];
    } else if (modeJoined && me) {
      const { data: mem, error: memErr } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', me);
      if (memErr) throw memErr;
      const ids = (mem ?? []).map((m: any) => m.group_id);
      if (ids.length > 0) {
        let q = supabase
          .from('groups')
          .select('id, title, description, city, capacity, category, game, created_at, host_id')
          .in('id', ids)
          .order('created_at', { ascending: false })
          .range(from, to);
        const { data, error } = await apply(q);
        if (error) throw error;
        rows = (data ?? []) as GroupRow[];
      } else {
        rows = [];
      }
    } else {
      let q = supabase
        .from('groups')
        .select('id, title, description, city, capacity, category, game, created_at, host_id')
        .order('created_at', { ascending: false })
        .range(from, to);
      const { data, error } = await apply(q);
      if (error) throw error;
      rows = (data ?? []) as GroupRow[];
    }

    setGroups(prev => [...prev, ...rows]);
    setPage(p => p + 1);
    setHasMore(rows.length === PAGE_SIZE);

    const ids = rows.map((g: GroupRow) => g.id);
    if (ids.length) {
      const { data: polls } = await supabase
        .from('group_polls')
        .select('group_id')
        .in('group_id', ids)
        .eq('status', 'open');
      const map: Record<string, boolean> = {};
      (polls ?? []).forEach((p: any) => { map[p.group_id] = true; });
      setOpenPolls(prev => ({ ...prev, ...map }));
    }
  } catch {
    // ignore
  } finally {
    setPaging(false);
  }
}

  const pageTitle = modeCreated
    ? "My Groups – Created"
    : modeJoined
    ? "My Groups – Joined"
    : category
    ? `Groups • ${category}`
    : "All Groups";

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
          <Link to="/browse" className="text-sm underline">Back</Link>
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
  {loading ? (
    <ul className="divide-y divide-black/5">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
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
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{err}</div>
  ) : groups.length === 0 ? (
    <div className="flex flex-col items-center justify-center gap-3 p-10 text-center text-neutral-600">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-70"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 3h10l4 7H3l4-7Z"/></svg>
      <div className="text-lg font-medium">No groups found</div>
      <div className="text-sm">Try a different filter or create a new one.</div>
      <div className="mt-2 flex justify-center gap-2">
        <Link to="/browse" className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04]">Back</Link>
        <Link to="/create" className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm text-white hover:brightness-110">New Group</Link>
      </div>
    </div>
  ) : (
    <>
      <ul className="divide-y divide-black/5">
        {groups.map((g) => (
          <li key={g.id} className="group py-1 first:pt-0 last:pb-0">
            <Link
              to={`/group/${g.id}`}
              className="block rounded-lg px-2 py-2 hover:bg-black/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 select-none items-center justify-center rounded-full border border-black/10 bg-neutral-100 text-sm font-semibold text-neutral-700">
                  {(g.title || g.game || 'G').slice(0,1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="truncate text-base font-medium text-neutral-900">{g.title ?? 'Untitled group'}</div>
                    {g.host_id === me && (
                      <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">Host</span>
                    )}
                    {openPolls[g.id] && (
                      <span className="shrink-0 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">Voting</span>
                    )}
                  </div>
                  <div className="mt-0.5 line-clamp-1 text-xs text-neutral-600">{g.description ?? 'No description'}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-neutral-700">
                    {g.category && <span className="rounded-full border border-black/10 bg-neutral-50 px-2 py-0.5">#{g.category}</span>}
                    {g.game && <span className="rounded-full border border-black/10 bg-neutral-50 px-2 py-0.5">{g.game}</span>}
                    {g.city && <span className="rounded-full border border-black/10 bg-neutral-50 px-2 py-0.5">{g.city}</span>}
                    {g.capacity && <span className="rounded-full border border-black/10 bg-neutral-50 px-2 py-0.5">{g.capacity} slots</span>}
                    {g.created_at && <span className="rounded-full border border-black/10 bg-neutral-50 px-2 py-0.5">{fmtDate(g.created_at)}</span>}
                  </div>
                </div>
                {unreadCounts[g.id] > 0 && (
                  <span className="ml-1 inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-emerald-600 px-1 text-xs font-semibold text-white">
                    {unreadCounts[g.id] > 99 ? '99+' : unreadCounts[g.id]}
                  </span>
                )}
              </div>
            </Link>
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
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
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