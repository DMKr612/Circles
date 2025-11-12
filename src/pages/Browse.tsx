import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

/**
 * BrowsePage
 * Clean, static "Browse Games" UI that mirrors the mock you shared.
 * Tailwind only; no extra deps. You can later wire real data into GAMES.
 * This replaces the previous "groups" listing page content.
 */

export type Game = {
  id: string;
  name: string;
  blurb: string;
  tag: string;
  online: number;
  groups: number;
  image: string;
};

type GroupRow = { id: string; title: string | null; description?: string | null; city?: string | null; category?: string | null; capacity?: number | null; created_at?: string | null; game?: string | null; code?: string | null; };

const CATEGORIES = ["All", "Games", "Study", "Outdoors"] as const;

export const GAMES: Game[] = [
  { id: "hokm",   name: "Hokm",        blurb: "Classic Persian card game",      tag: "Games",    online: 120, groups: 8,  image: "🎴" },
  { id: "takhtenard",   name: "Takhte Nard", blurb: "Traditional backgammon",         tag: "Games",    online: 95,  groups: 6,  image: "🎲" },
  { id: "mafia",  name: "Mafia",       blurb: "Social deduction party game",     tag: "Games",    online: 210, groups: 12, image: "🕵️" },
  { id: "mono",   name: "Monopoly",    blurb: "Buy, sell, and trade properties", tag: "Games",    online: 180, groups: 10, image: "💰" },
  { id: "uno",    name: "Uno",         blurb: "Colorful card matching fun",      tag: "Games",    online: 250, groups: 15, image: "🃏" },

  { id: "chess",  name: "Chess",       blurb: "Classic strategy board game",     tag: "Games",    online: 130, groups: 9,  image: "♟️" },

  { id: "mathematics",   name: "Mathematics", blurb: "Study numbers and problem solving", tag: "Study",   online: 75,  groups: 5,  image: "📐" },
  { id: "biology",    name: "Biology",     blurb: "Explore life sciences",             tag: "Study",   online: 60,  groups: 4,  image: "🧬" },
  { id: "chemistry",   name: "Chemistry",   blurb: "Learn about chemicals and reactions", tag: "Study",  online: 50,  groups: 3,  image: "⚗️" },
  { id: "history",   name: "History",     blurb: "Discover past events and cultures",  tag: "Study",  online: 45,  groups: 3,  image: "📜" },

  { id: "dreisam",  name: "Mountain Dreisam Hike", blurb: "Join a hike up Dreisam mountain", tag: "Outdoors", online: 40, groups: 3,  image: "⛰️" },
  { id: "visit",   name: "Visiting",    blurb: "Cultural and city visits",            tag: "Outdoors", online: 55, groups: 4,  image: "🏛️" },
  { id: "camp",    name: "Camping",     blurb: "Overnight outdoor camping trips",     tag: "Outdoors", online: 35, groups: 2,  image: "🏕️" },
  { id: "kayak",   name: "Kayaking",    blurb: "Water adventures on rivers and lakes", tag: "Outdoors", online: 30, groups: 2, image: "🛶" },
];


export default function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const groupId = params.get("id");
  const code = params.get("code");
  const [q, setQ] = useState<string>(params.get("q") ?? "");
  const [cat, setCat] = useState<typeof CATEGORIES[number]>(
    (params.get("category") as typeof CATEGORIES[number]) ?? "All"
  );

  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [last6hOnly, setLast6hOnly] = useState(true);
  const [loading, setLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  // Memoized detector for code typed into search box
  const codeFromQ = useMemo(() => {
  const s = (q || "").trim();
  // allow dashes/spaces; normalize to A–Z0–9
  const cleaned = s.replace(/[^A-Za-z0-9]/g, "");
  // treat 6–16 chars as a possible invite code
  return /^[A-Za-z0-9]{6,16}$/.test(cleaned) ? cleaned.toUpperCase() : null;
}, [q]);

const PAGE_SIZE = 12;
const [page, setPage] = useState(0);
const [hasMore, setHasMore] = useState(false);
const [paging, setPaging] = useState(false);
const [err, setErr] = useState<string | null>(null);
  // live stats
  const [groupCountByGame, setGroupCountByGame] = useState<Record<string, number>>({});
  const [memberCountByGame, setMemberCountByGame] = useState<Record<string, number>>({});
  const [totalOnlineLive, setTotalOnlineLive] = useState<number>(0);
  // whitelist: category (lowercase) -> allowed game slugs
  const [allowedByCat, setAllowedByCat] = useState<Record<string, string[]>>({});

  // request category modal state
  const [showReq, setShowReq] = useState(false);
  const [reqName, setReqName] = useState("");
  const [reqNote, setReqNote] = useState("");
  const [reqBusy, setReqBusy] = useState(false);
  const [reqMsg, setReqMsg] = useState<string | null>(null);

  useEffect(() => {
    const next = new URLSearchParams(params);
    // keep URL in sync with UI selections
    if (cat && cat !== "All") next.set("category", cat); else next.delete("category");
    if (q) next.set("q", q); else next.delete("q");
    if (groupId) next.set("id", groupId); else next.delete("id");
    if (code) next.set("code", code); else next.delete("code");
    if (!code && codeFromQ) next.set("code", (q || "").trim());
    else if (!codeFromQ) next.delete("code");
    // only push an update if something actually changed
    if (next.toString() !== params.toString()) {
      setParams(next, { replace: true });
    }
  }, [q, cat, groupId, code, codeFromQ]);

  useEffect(() => {
    let mounted = true;

    async function load(reset: boolean) {
      try {
        if (code || codeFromQ) {
  const raw = (code || codeFromQ)!;
  const cleaned = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const looksUuid = /^[0-9a-fA-F-]{32,36}$/.test(raw);

  // 1) exact code match (normalized)
  const exact = await supabase
    .from("groups")
    .select("id, title, description, city, category, game, created_at, code")
    .eq("code", cleaned)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (exact.error) throw exact.error;
  if (mounted && exact.data) {
    setGroups([exact.data as GroupRow]);
    setHasMore(false);
    setErr(null);
    return;
  }

  // 2) fuzzy code search (case-insensitive, supports partial/dashed)
  let fuzzyQuery = supabase
    .from("groups")
    .select("id, title, description, city, category, game, created_at, code")
    .order("created_at", { ascending: false })
    .limit(5)
    .ilike("code", `%${cleaned}%`);

  // 3) also try by id when the input looks like a UUID
  if (looksUuid) {
    const byId = await supabase
      .from("groups")
      .select("id, title, description, city, category, game, created_at, code")
      .eq("id", raw)
      .maybeSingle();
    if (byId.error) throw byId.error;
    if (mounted && byId.data) {
      setGroups([byId.data as GroupRow]);
      setHasMore(false);
      setErr(null);
      return;
    }
  }

  const { data: fuzzyRows, error: fuzzyErr } = await fuzzyQuery;
  if (fuzzyErr) throw fuzzyErr;
  if (!mounted) return;
  setGroups((fuzzyRows ?? []) as GroupRow[]);
  setHasMore(false);
  setErr(null);
  return;
}
        if (groupId) {
          const { data, error } = await supabase
            .from("groups")
            .select("id, title, description, city, category, game, created_at, code")
            .eq("id", groupId)
            .single();
          if (error) throw error;
          if (!mounted) return;
          setGroups(data ? [data as GroupRow] : []);
          setHasMore(false);
          setErr(null);
          return;
        }
        if (reset) {
          setLoading(true);
          setGroups([]);
          setPage(0);
          setHasMore(false);
          setErr(null);
        } else {
          setPaging(true);
        }

        let base = supabase
          .from("groups")
          .select("id, title, description, city, category, game, created_at, code")
          .order("created_at", { ascending: false });

        if (cat && cat !== "All") {
          const catLower = cat.toLowerCase();
          const ids = allowedByCat[catLower] ?? [];
          if (ids.length) {
            const inList = ids.map((s) => `"${s}"`).join(",");
            base = base.or(`game.in.(${inList}),category.eq.${catLower}`);
          } else {
            base = base.eq("category", catLower);
          }
        }
        if (q.trim()) {
          const s = q.trim();
          base = base.or(`title.ilike.%${s}%,game.ilike.%${s}%`);
        }
        if (last6hOnly) {
          const sinceIso = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
          base = supabase
            .from("groups")
            .select("id, title, description, city, category, game, created_at, code")
            .gte("created_at", sinceIso)
            .order("created_at", { ascending: false });
        }

        const from = 0;
        const to = PAGE_SIZE - 1;
        const { data, error } = await base.range(from, to);
        if (error) throw error;
        if (!mounted) return;

        const rows = (data ?? []) as GroupRow[];
        setGroups(rows);
        setHasMore(rows.length === PAGE_SIZE);
        setErr(null);
      } catch (e: any) {
        if (!mounted) return;
        setErr(e?.message ?? "Failed to load groups");
      } finally {
        if (!mounted) return;
        setLoading(false);
        setPaging(false);
      }
    }

    load(true);
    return () => { mounted = false; };
  }, [cat, q, allowedByCat, groupId, code, codeFromQ, last6hOnly, reloadTick]);
  async function loadMore() {
    if (paging || loading || !hasMore) return;
    if (groupId) return;
    if (code) return;
    if (codeFromQ) return;
    if (last6hOnly) return;
    setPaging(true);
    try {
      let base = supabase
        .from("groups")
        .select("id, title, description, city, category, game, created_at, code")
        .order("created_at", { ascending: false });

      if (cat && cat !== "All") {
        const catLower = cat.toLowerCase();
        const ids = allowedByCat[catLower] ?? [];
        if (ids.length) {
          const inList = ids.map((s) => `"${s}"`).join(",");
          base = base.or(`game.in.(${inList}),category.eq.${catLower}`);
        } else {
          base = base.eq("category", catLower);
        }
      }
      if (q.trim()) {
        const s = q.trim();
        base = base.or(`title.ilike.%${s}%,game.ilike.%${s}%`);
      }
      if (last6hOnly) {
        const sinceIso = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
        base = supabase
          .from("groups")
          .select("id, title, description, city, category, game, created_at, code")
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false });
      }

      const from = (page + 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await base.range(from, to);
      if (error) throw error;
      const rows = (data ?? []) as GroupRow[];
      setGroups((prev) => [...prev, ...rows]);
      setPage((p) => p + 1);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load groups");
    } finally {
      setPaging(false);
    }
  }

  // load allowed games → build category→ids map
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

  // load live counts once
  useEffect(() => {
    let mounted = true;
    (async () => {
      // count groups per game
      const { data: groupsRows } = await supabase
        .from("groups")
        .select("id, game");
      if (!mounted) return;
      const gc: Record<string, number> = {};
      (groupsRows ?? []).forEach((r: any) => {
        const k = (r.game || "").toLowerCase();
        if (!k) return;
        gc[k] = (gc[k] || 0) + 1;
      });
      setGroupCountByGame(gc);

      // distinct members per game (proxy for online)
      const { data: memRows } = await supabase
        .from("group_members")
        .select("user_id, groups(game)");
      if (!mounted) return;
      const gameUsers: Record<string, Set<string>> = {};
      const allUsers = new Set<string>();
      (memRows ?? []).forEach((r: any) => {
        const g = r?.groups?.game ? String(r.groups.game).toLowerCase() : "";
        const u = r?.user_id ? String(r.user_id) : "";
        if (!g || !u) return;
        allUsers.add(u);
        if (!gameUsers[g]) gameUsers[g] = new Set();
        gameUsers[g].add(u);
      });
      const mc: Record<string, number> = {};
      Object.entries(gameUsers).forEach(([k, set]) => {
        mc[k] = (set as Set<string>).size;
      });
      setMemberCountByGame(mc);
      setTotalOnlineLive(allUsers.size);
    })();
    return () => { mounted = false; };
  }, []);

  const filtered = useMemo(() => {
    const byCat = cat === "All" ? GAMES : GAMES.filter(g => g.tag === cat);
    const byText = q.trim()
      ? byCat.filter(g => g.name.toLowerCase().includes(q.toLowerCase()))
      : byCat;
    return byText;
  }, [q, cat]);

  const totalOnline = totalOnlineLive;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      {/* HEADER */}
      <div className="mb-8 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Browse Games</h1>
          <p className="mt-2 text-neutral-600">
            Discover games and find players to join
          </p>

          {/* search */}
          <div className="mt-5 flex items-center gap-2">
            <div className="relative">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search games…"
                className="w-[420px] max-w-full rounded-xl border px-3 py-2 pl-9 text-sm outline-none ring-0 focus:border-emerald-500"
              />
              <span className="pointer-events-none absolute left-3 top-2.5 text-neutral-400">🔎</span>
            </div>
            <Link
              to="/groups"
              className="rounded-md border border-black/10 bg-white px-4 py-2 text-sm hover:bg-black/[0.04]"
            >
              My Groups
            </Link>
          </div>

          {/* category pills */}
          <div className="mt-4 flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  c === cat
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "bg-white text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* right stats */}
        <div className="shrink-0 text-right">
          <div className="text-3xl font-semibold text-emerald-700">
            {totalOnline.toLocaleString()}
          </div>
          <div className="text-sm text-neutral-500">Players Online</div>
          <button
            onClick={() => { setShowReq(true); setReqMsg(null); }}
            className="mt-3 rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04]"
          >
            Request Category
          </button>
        </div>
      </div>

      {/* GRID */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((g) => (
          <GameCard
            key={g.id}
            game={g}
            groupCount={groupCountByGame[g.id] ?? 0}
            memberCount={memberCountByGame[g.id] ?? 0}
          />
        ))}
      </div>

      {/* RESULTS: matching groups */}
      <div className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">
            {(code || codeFromQ)
              ? "Group by Code"
              : groupId
                ? "Group by ID"
                : last6hOnly
                  ? "Groups from last 6 hours"
                  : cat !== "All"
                    ? `Groups in ${cat}`
                    : q
                      ? `Groups matching “${q}”`
                      : ""}
          </h2>
          <button
            onClick={() => setReloadTick((t) => t + 1)}
            className="text-sm text-neutral-600 hover:text-neutral-800"
          >
            Refresh
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-black/10 bg-white">
          {err ? (
            <div className="p-6 text-red-700">{err}</div>
          ) : loading && groups.length === 0 ? (
            <div className="p-6 text-neutral-500">Loading…</div>
          ) : groups.length === 0 ? (
            last6hOnly ? (
              <div className="p-6 text-center">
                <div className="text-lg font-semibold text-neutral-900">No groups in the last 6 hours</div>
                <div className="mt-1 text-sm text-neutral-600">
                  This view only lists groups created since the last 6 hours (UTC).
                </div>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <button
                    onClick={() => setReloadTick((t) => t + 1)}
                    className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04]"
                  >
                    Refresh
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6 text-neutral-500">No groups found.</div>
            )
          ) : (
            <>
              <ul>
                {groups.map((g) => {
                  const gid = (g as any)?.id
                    ?? (g as any)?.group_id
                    ?? (g as any)?.group?.id
                    ?? (g as any)?.groups?.id;
                  if (!gid) return null;
                  return (
                    <li key={gid} className="border-t border-black/5 px-6 py-4 first:border-none">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-neutral-900">{g.title}</div>
                        </div>
                        <Link
                          to={`/group/${gid}`}
                          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                        >
                          View
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {hasMore && (
                <div className="border-t border-black/5 p-4 text-center">
                  <button
                    onClick={loadMore}
                    className="inline-flex items-center gap-2 rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04] disabled:opacity-60"
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
      </div>

      {/* Request Category Modal */}
      {showReq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between">
              <h3 className="text-lg font-semibold">Request new category</h3>
              <button
                onClick={() => setShowReq(false)}
                className="rounded-md px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-100"
              >
                ✕
              </button>
            </div>
            <form
              className="mt-4 space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setReqBusy(true);
                setReqMsg(null);
                const { data: userRes, error: uErr } = await supabase.auth.getUser();
                if (uErr || !userRes?.user) {
                  setReqMsg("Sign in required.");
                  setReqBusy(false);
                  return;
                }
                const payload = {
                  name: reqName.trim().toLowerCase(),
                  note: reqNote.trim() || null,
                  requested_by: userRes.user.id
                };
                const { error } = await supabase.from("category_requests").insert(payload);
                if (error) {
                  setReqMsg(error.message);
                } else {
                  setReqMsg("Request sent.");
                  setReqName("");
                  setReqNote("");
                }
                setReqBusy(false);
              }}
            >
              <div>
                <label className="block text-sm font-medium text-neutral-800">Category name</label>
                <input
                  value={reqName}
                  onChange={(e) => setReqName(e.target.value)}
                  placeholder="e.g., Tournaments"
                  required
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-800">Note (optional)</label>
                <textarea
                  value={reqNote}
                  onChange={(e) => setReqNote(e.target.value)}
                  placeholder="Why should this category be added?"
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  rows={3}
                />
              </div>
              {reqMsg && <div className="text-sm text-neutral-600">{reqMsg}</div>}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowReq(false)}
                  className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reqBusy || !reqName.trim()}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                >
                  {reqBusy ? "Sending…" : "Send request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function GameCard({ game, groupCount, memberCount }: { game: Game; groupCount: number; memberCount: number }) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      {/* top row */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 text-neutral-400 text-2xl">
            {game.image}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-neutral-900">{game.name}</h3>
              <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                Trending
              </span>
            </div>
            <p className="text-sm text-neutral-600">{game.blurb}</p>
          </div>
        </div>

        <span className="rounded-md border px-2 py-0.5 text-[11px] text-neutral-600">
          {game.tag}
        </span>
      </div>

      {/* stats */}
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-neutral-600">
        <div className="flex items-center gap-2">
          <span className="text-emerald-600">👥</span>
          <span>
            <span className="font-medium text-neutral-900">{memberCount.toLocaleString()}</span> online
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span>👤</span>
          <span>
            <span className="font-medium text-neutral-900">{groupCount}</span> active groups
          </span>
        </div>
      </div>

      {/* actions */}
      <div className="mt-4 flex items-center gap-3">
        <Link
          to={`/groups/game/${encodeURIComponent(game.id)}`}
          className="inline-flex flex-1 items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Find Groups
        </Link>
        <button
          className="rounded-lg border px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
          onClick={() => alert("Quick Match coming soon")}
        >
          Quick Match
        </button>
      </div>
    </div>
  );
}