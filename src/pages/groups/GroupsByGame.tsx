import { useEffect, useState } from 'react';
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

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('groups')
        .select('*')
        .eq('game', key)
        .order('created_at', { ascending: false })
        .limit(100);
      if (!mounted) return;
      if (error) setErr(error.message); else setRows(data ?? []);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [key]);

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

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:mb-8 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">Groups · {display}</h1>
          <p className="mt-1 text-sm text-neutral-600">Join an existing room or create your own.</p>
          <p className="mt-1 text-xs text-neutral-500">{rows.length} group{rows.length === 1 ? '' : 's'}</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Link to="/browse" className="flex-1 rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04] sm:flex-none">Back</Link>
          <Link to="/create" className="flex-1 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 sm:flex-none">New Group</Link>
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

      {!loading && !err && rows.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/80 p-10 text-center shadow-sm backdrop-blur">
          <div className="mx-auto flex max-w-sm flex-col items-center justify-center gap-3 text-neutral-600">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-70"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 3h10l4 7H3l4-7Z"/></svg>
            <div className="text-lg font-medium">No groups for “{display}”</div>
            <div className="text-sm">Be the first to create one.</div>
            <Link to="/create" className="mt-2 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:brightness-110">New Group</Link>
          </div>
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-black/10 bg-white/80 p-4 shadow-sm backdrop-blur">
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map(g => (
            <li key={g.id} className="group rounded-xl border border-black/10 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-within:ring-emerald-500 focus-within:ring-2 focus-within:ring-offset-2">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <Avatar text={g.game || g.name || g.city || ''} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-base font-semibold text-neutral-900">
                        {(g.name || (g as any).title || (g as any).group_name || 'Untitled group')}
                      </h2>
                      {badge('border-emerald-300 bg-emerald-50 text-emerald-700', g.is_online ? 'Online' : 'In-person')}
                    </div>
                    {g.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-neutral-600">{g.description}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1 text-xs text-neutral-700">
                      {badge('border-black/10 bg-neutral-50', g.category ? `#${g.category}` : '#general')}
                      {g.game && badge('border-black/10 bg-neutral-50', g.game)}
                      {g.city && badge('border-black/10 bg-neutral-50', g.city)}
                      {g.created_at && badge('border-black/10 bg-neutral-50', fmtDate(g.created_at))}
                    </div>
                    {g.is_online && g.online_link && (
                      <a className="mt-3 inline-block text-sm underline" href={g.online_link} target="_blank" rel="noreferrer">
                        Join link
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                  {memberOf.has(g.id) ? (
                    <Link
                      to={`/group/${g.id}`}
                      className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                    >
                      View
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
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}