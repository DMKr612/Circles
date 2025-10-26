import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from "../../lib/supabase";
// import { GAMES } from "../Browse";

type Group = {
  id: string;
  name: string | null;
  description: string | null;
  game: string | null;
  category: string | null;
  is_online: boolean | null;
  online_link: string | null;
  city: string | null;
  created_at: string | null;
};

function fmtDate(d?: string | null) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString(); } catch { return ''; }
}

function normCity(s?: string | null) {
  if (!s) return '';
  try {
    return s.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
  } catch {
    return s.toLowerCase().trim();
  }
}

function badge(cls: string, text: string) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${cls}`}>{text}</span>
  );
}

function Avatar({ text }: { text: string }) {
  const letter = (text || '').trim().slice(0, 1).toUpperCase() || 'G';
  return (
    <div className="flex h-9 w-9 select-none items-center justify-center rounded-full border border-black/10 bg-neutral-100 text-sm font-semibold text-neutral-700">
      {letter}
    </div>
  );
}

export default function GroupsByGame() {
  const { game = '' } = useParams();
  const key = (game || '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
  const display = (game || '').replace(/-/g, ' ').trim();

  const [rows, setRows] = useState<Group[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // membership state
  const [userId, setUserId] = useState<string | null>(null);
  const [memberOf, setMemberOf] = useState<Set<string>>(new Set());
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const [sortBy, setSortBy] = useState<'new' | 'online'>('new');
  const [onlineCounts, setOnlineCounts] = useState<Record<string, number>>({});
  const [cityQuery, setCityQuery] = useState<string>('');
  const [cityMode, setCityMode] = useState<'all' | 'mine'>('all');
  const [myCity, setMyCity] = useState<string | null>(null);
  const [myCityLoading, setMyCityLoading] = useState(false);

  async function refreshMyCity() {
    try {
      setMyCityLoading(true);
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id ?? null;
      if (!uid) { setMyCity(null); setMyCityLoading(false); return; }
      // try `id` first, then fall back to `user_id` schemas
      let prof: any = null;
      const { data: p1 } = await supabase
        .from('profiles')
        .select('city, location, id, user_id')
        .eq('id', uid)
        .maybeSingle();
      prof = p1 ?? null;
      if (!prof) {
        const { data: p2 } = await supabase
          .from('profiles')
          .select('city, location, id, user_id')
          .eq('user_id', uid)
          .maybeSingle();
        prof = p2 ?? null;
      }
      const val = (prof?.city as string) || (prof?.location as string) || null;
      const normalized = val && typeof val === 'string' ? val.trim() : null;
      setMyCity(normalized);
      if (normalized) {
        localStorage.setItem('myCity', normalized);
        localStorage.setItem('profile.city', normalized);
        // also broadcast for any listeners
        try { window.dispatchEvent(new CustomEvent('my-city-changed', { detail: { city: normalized } })); } catch {}
      }
    } catch {
      setMyCity(null);
    } finally {
      setMyCityLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      let q = supabase
        .from('groups')
        .select('*')
        .eq('game', key)
        .order('created_at', { ascending: false })
        .limit(100);
      if (cityMode === 'mine' && myCity) {
        // server-side filter (case-insensitive, substring match)
        q = q.ilike('city', `%${myCity}%`);
      }
      const { data, error } = await q;
      if (!mounted) return;
      if (error) {
        setErr(error.message);
      } else {
        const gs = data ?? [];
        setRows(gs);
        // best-effort estimate of online users: recent reads in the last 5 minutes
        try {
          const ids = gs.map((g: any) => g.id).filter(Boolean);
          if (ids.length) {
            const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
            const { data: reads } = await supabase
              .from('group_reads')
              .select('group_id, updated_at, user_id')
              .in('group_id', ids)
              .gt('updated_at', since);
            const map: Record<string, number> = {};
            (reads ?? []).forEach((r: any) => {
              const k = String(r.group_id);
              map[k] = (map[k] ?? 0) + 1;
            });
            setOnlineCounts(map);
          } else {
            setOnlineCounts({});
          }
        } catch {
          // ignore if table/columns differ; UI will just show 0
          setOnlineCounts({});
        }
      }
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [key, cityMode, myCity]);

  // load current user + memberships
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id ?? null;
      if (!mounted) return;
      setUserId(uid);
      if (!uid) { setMemberOf(new Set()); return; }

      const { data, error } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', uid);

      if (!mounted) return;
      if (error) { setMemberOf(new Set()); return; }
      setMemberOf(new Set((data ?? []).map((r: any) => r.group_id)));

      // try to load user's city from profiles (city or location fallback)
      try {
        if (uid) {
          let prof: any = null;
          // primary attempt: id = auth.users.id
          const { data: p1 } = await supabase
            .from('profiles')
            .select('city, location, id, user_id')
            .eq('id', uid)
            .maybeSingle();
          prof = p1 ?? null;
          // fallback for schemas that use user_id instead of id
          if (!prof) {
            const { data: p2 } = await supabase
              .from('profiles')
              .select('city, location, id, user_id')
              .eq('user_id', uid)
              .maybeSingle();
            prof = p2 ?? null;
          }
          const val = (prof?.city as string) || (prof?.location as string) || null;
          const normalized = val && typeof val === 'string' ? val.trim() : null;
          setMyCity(normalized);
          if (normalized) {
            try { localStorage.setItem('profile.city', normalized); } catch {}
          }
        } else {
          setMyCity(null);
        }
      } catch {
        setMyCity(null);
      }
    })();
    return () => { mounted = false; };
  }, []);

  async function joinGroup(groupId: string) {
    if (!userId) { setErr('Sign in required'); return; }
    setJoiningId(groupId);
    const { error } = await supabase
      .from('group_members')
      .insert({ group_id: groupId, user_id: userId, role: 'member' });
    if (!error) {
      const next = new Set(memberOf);
      next.add(groupId);
      setMemberOf(next);
    } else {
      setErr(error.message);
    }
    setJoiningId(null);
  }

  const visibleRows = useMemo(() => {
    let list = [...rows];
    // mode filter
    if (cityMode === 'mine' && myCity) {
      const mc = normCity(myCity);
      list = list.filter(r => normCity(r.city).includes(mc));
    }
    // free-text search by city
    const q = normCity(cityQuery);
    if (q) list = list.filter(r => normCity(r.city).includes(q));
    // sorting
    if (sortBy === 'online') {
      list.sort((a, b) => (onlineCounts[b.id] ?? 0) - (onlineCounts[a.id] ?? 0));
    } else {
      list.sort((a, b) =>
        new Date(b.created_at ?? '').getTime() - new Date(a.created_at ?? '').getTime()
      );
    }
    return list;
  }, [rows, cityMode, myCity, cityQuery, sortBy, onlineCounts]);

  // pick up city from localStorage if profile city not loaded yet and keep in sync
  useEffect(() => {
    const cached =
      localStorage.getItem('myCity') ||
      localStorage.getItem('profile.city') ||
      localStorage.getItem('city') ||
      null;
    if (!myCity && cached) setMyCity(cached);
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'myCity' || e.key === 'profile.city' || e.key === 'city') {
        setMyCity(e.newValue);
      }
    };
    const onCustom = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail;
        if (detail?.city) setMyCity(String(detail.city));
      } catch {}
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('my-city-changed', onCustom as any);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('my-city-changed', onCustom as any);
    };
  }, [myCity]);

  // if user selects "My city" but we don't have one yet, try to fetch once
  useEffect(() => {
    if (cityMode === 'mine' && !myCity && !myCityLoading) {
      refreshMyCity();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityMode]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:mb-8 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">Groups · {display}</h1>
          <p className="mt-1 text-sm text-neutral-600">Join an existing room or create your own.</p>
          {cityMode === 'mine' && !myCity && !myCityLoading && (
            <p className="mt-1 text-xs text-amber-700">Tip: Set your city in your profile to enable “My city”.</p>
          )}
          {cityMode === 'mine' && !myCity && myCityLoading && (
            <p className="mt-1 text-xs text-neutral-500">Checking your profile city…</p>
          )}
          <p className="mt-1 text-xs text-neutral-500">{rows.length} group{rows.length === 1 ? '' : 's'}</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <div className="flex gap-2">
            <Link to="/browse" className="flex-1 rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04] sm:flex-none">Back</Link>
            <Link to="/create" className="flex-1 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 sm:flex-none">New Group</Link>
          </div>
          <div className="flex gap-2 sm:ml-4">
            <select
              value={cityMode}
              onChange={(e) => setCityMode(e.target.value as 'all' | 'mine')}
              className="rounded-md border border-black/10 bg-white px-2 py-1.5 text-sm text-neutral-800"
              aria-label="City scope"
              title={myCity ? `Your city: ${myCity}` : 'Click to set your city in your profile'}
            >
              <option value="all">All</option>
              <option value="mine">
                {myCity ? `My city (${myCity})` : 'My city (set in profile)'}
              </option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="rounded-md border border-black/10 bg-white px-2 py-1.5 text-sm text-neutral-800"
            >
              <option value="new">Newest</option>
              <option value="online">Most online</option>
            </select>
            <input
              value={cityQuery}
              onChange={(e) => setCityQuery(e.target.value)}
              placeholder="Search city…"
              className="w-full min-w-[160px] rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm text-neutral-800 placeholder-neutral-400"
            />
          </div>
        </div>
      </div>

      {loading && (
        <div className="mt-6 rounded-2xl border border-black/10 bg-white/80 p-4 shadow-sm backdrop-blur">
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
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
        </div>
      )}

      {err && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{err}</div>
      )}

      {!loading && !err && visibleRows.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/80 p-10 text-center shadow-sm backdrop-blur">
          <div className="mx-auto flex max-w-sm flex-col items-center justify-center gap-3 text-neutral-600">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-70"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 3h10l4 7H3l4-7Z"/></svg>
            <div className="text-lg font-medium">No groups for “{display}”</div>
            <div className="text-sm">Be the first to create one.</div>
            <Link to="/create" className="mt-2 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:brightness-110">New Group</Link>
          </div>
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-black/10 bg-white/80 shadow-sm backdrop-blur">
        <ul className="divide-y divide-black/10">
          {visibleRows.map(g => (
            <li
              key={g.id}
              className="group flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 hover:bg-emerald-50 transition"
            >
              <div className="flex items-center gap-4">
                <Avatar text={g.game || g.name || g.city || ''} />
                <div>
                  <h2 className="text-base font-semibold text-neutral-900 flex items-center gap-2">
                    {(g.name || (g as any).title || (g as any).group_name || 'Untitled group')}
                    {badge('border-emerald-300 bg-emerald-50 text-emerald-700', g.is_online ? 'Online' : 'In-person')}
                    {badge('border-emerald-200 bg-emerald-50 text-emerald-700', `${onlineCounts[g.id] ?? 0} online`)}
                  </h2>
                  {g.description && (
                    <p className="mt-1 text-sm text-neutral-600 line-clamp-1">
                      {g.description}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-1 text-sm text-neutral-700">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 21s-6.938-5.167-6.938-10.125A6.938 6.938 0 0112 3.937a6.938 6.938 0 016.938 6.938C18.938 15.833 12 21 12 21z"/><circle cx="12" cy="10.875" r="2.5"/></svg>
                    <span>{g.city || '—'}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-700">
                    {badge('border-black/10 bg-neutral-50', g.category ? `#${g.category}` : '#general')}
                    {g.game && badge('border-black/10 bg-neutral-50', g.game)}
                    {g.city && badge('border-black/10 bg-neutral-50', g.city)}
                    {g.created_at && badge('border-black/10 bg-neutral-50', fmtDate(g.created_at))}
                  </div>
                </div>
              </div>
              <div className="mt-3 sm:mt-0 flex shrink-0 gap-2">
                {memberOf.has(g.id) ? (
                  <Link
                    to={`/group/${g.id}`}
                    className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                  >
                    Open
                  </Link>
                ) : (
                  <button
                    onClick={() => joinGroup(g.id)}
                    disabled={joiningId === g.id}
                    className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                  >
                    {joiningId === g.id ? 'Joining…' : 'Join'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
} 