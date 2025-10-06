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
          queryBuilder = queryBuilder.or(`game_slug.eq.${leaf},game.ilike.%${catLower}%,title.ilike.%${catLower}%`);
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
      .upsert({ group_id: groupId, user_id: me, role: "member" });
    if (error) {
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
            to="/groups/new"
            className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm text-white hover:brightness-110"
          >
            New Group
          </Link>
        </div>
      </div>

      {/* Results */}
      <div className="mt-6 rounded-xl border border-black/10 bg-white">
        {loading ? (
          <ul className="divide-y divide-black/5">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="p-4 flex items-start justify-between gap-4">
                <div className="w-full">
                  <div className="h-4 w-48 animate-pulse rounded bg-neutral-200" />
                  <div className="mt-2 h-3 w-5/6 animate-pulse rounded bg-neutral-200" />
                  <div className="mt-1 h-3 w-2/3 animate-pulse rounded bg-neutral-200" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-8 w-20 animate-pulse rounded bg-neutral-200" />
                  <div className="h-8 w-20 animate-pulse rounded bg-neutral-200" />
                </div>
              </li>
            ))}
          </ul>
        ) : err ? (
          <div className="p-6 text-red-700">{err}</div>
        ) : groups.length === 0 ? (
          <div className="p-6 text-neutral-600">No groups found.</div>
        ) : (
          <>
            <ul className="divide-y divide-black/5">
              {groups.map((g) => (
                <li key={g.id} className="p-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium">{g.title ?? "Untitled group"}</div>
                    {g.description && <div className="text-sm text-neutral-600">{g.description}</div>}
                    <div className="mt-1 text-xs text-neutral-500">
                      {g.category ? `#${g.category}` : "#general"}
                      {g.game ? ` • ${g.game}` : ""}
                      {g.city ? ` • ${g.city}` : ""}
                      {g.capacity ? ` • ${g.capacity} slots` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link to={`/group/${g.id}`} className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04]">View</Link>
                    <button onClick={() => handleJoin(g.id)} className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm text-white hover:brightness-110">Join</button>
                    {g.host_id === me && (
                      openPolls[g.id] ? (
                        <Link to={`/group/${g.id}#polls`} className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04]">Manage voting</Link>
                      ) : (
                        <button onClick={() => createPollFor(g.id)} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:brightness-110">Create voting</button>
                      )
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {hasMore && (
              <div className="border-t border-black/5 p-4 text-center">
                <button
                  onClick={() => (async () => { await (async () => { const el = document.activeElement as HTMLElement | null; el?.blur?.(); })(); await (async () => {})(); })().then(() => {})}
                  className="hidden"
                />
                <button
                  onClick={() => (async () => { /* load next page */ const mounted = true; try { setPaging(true); const from = (page + 1) * PAGE_SIZE; const to = from + PAGE_SIZE - 1; let rows: GroupRow[] = []; if (modeCreated && me) { let q = supabase.from('groups').select('id, title, description, city, capacity, category, game, created_at, host_id').eq('host_id', me).order('created_at', { ascending: false }).range(from, to); const { data, error } = await ( (qb:any)=>{ let b=qb; const catLower = category?category.toLowerCase():''; const HIGH_LEVEL = new Set(['games','study','outdoors']); if (catLower){ if (HIGH_LEVEL.has(catLower)){ const ids = allowedByCat[catLower]??[]; if (ids.length>0){ const inList = ids.map(s=>`"${s}"`).join(','); b=b.or(`game.in.(${inList}),category.eq.${catLower}`);} else { b=b.eq('category', catLower);} } else { const leaf = catLower.replace(/[^a-z0-9]+/g,''); b=b.or(`game_slug.eq.${leaf},game.ilike.%${catLower}%,title.ilike.%${catLower}%`);} } if (search.trim()){ const q=search.trim(); b=b.or(`title.ilike.%${q}%,game.ilike.%${q}%`);} return b; })(q); if (error) throw error; rows = (data??[]) as GroupRow[]; } else if (modeJoined && me) { const { data: mem } = await supabase.from('group_members').select('group_id').eq('user_id', me); const ids = (mem??[]).map((m:any)=>m.group_id); if (ids.length>0){ let q = supabase.from('groups').select('id, title, description, city, capacity, category, game, created_at, host_id').in('id', ids).order('created_at', { ascending: false }).range(from, to); const { data, error } = await ( (qb:any)=>{ let b=qb; const catLower = category?category.toLowerCase():''; const HIGH_LEVEL = new Set(['games','study','outdoors']); if (catLower){ if (HIGH_LEVEL.has(catLower)){ const ids = allowedByCat[catLower]??[]; if (ids.length>0){ const inList = ids.map(s=>`"${s}"`).join(','); b=b.or(`game.in.(${inList}),category.eq.${catLower}`);} else { b=b.eq('category', catLower);} } else { const leaf = catLower.replace(/[^a-z0-9]+/g,''); b=b.or(`game_slug.eq.${leaf},game.ilike.%${catLower}%,title.ilike.%${catLower}%`);} } if (search.trim()){ const q=search.trim(); b=b.or(`title.ilike.%${q}%,game.ilike.%${q}%`);} return b; })(q); if (error) throw error; rows = (data??[]) as GroupRow[]; } }
                  else { let q = supabase.from('groups').select('id, title, description, city, capacity, category, game, created_at, host_id').order('created_at', { ascending: false }).range(from, to); const { data, error } = await ( (qb:any)=>{ let b=qb; const catLower = category?category.toLowerCase():''; const HIGH_LEVEL = new Set(['games','study','outdoors']); if (catLower){ if (HIGH_LEVEL.has(catLower)){ const ids = allowedByCat[catLower]??[]; if (ids.length>0){ const inList = ids.map(s=>`"${s}"`).join(','); b=b.or(`game.in.(${inList}),category.eq.${catLower}`);} else { b=b.eq('category', catLower);} } else { const leaf = catLower.replace(/[^a-z0-9]+/g,''); b=b.or(`game_slug.eq.${leaf},game.ilike.%${catLower}%,title.ilike.%${catLower}%`);} } if (search.trim()){ const q=search.trim(); b=b.or(`title.ilike.%${q}%,game.ilike.%${q}%`);} return b; })(q); if (error) throw error; rows = (data??[]) as GroupRow[]; } setGroups(prev => [...prev, ...rows]); setPage(p => p + 1); setHasMore(rows.length === PAGE_SIZE); const ids = rows.map((g: GroupRow)=>g.id); if (ids.length){ const { data: polls } = await supabase.from('group_polls').select('group_id').in('group_id', ids).eq('status','open'); const map: Record<string, boolean> = {}; (polls??[]).forEach((p:any)=>{ map[p.group_id]=true; }); setOpenPolls(prev=>({ ...prev, ...map })); } } finally { setPaging(false); } })()}
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