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
        .eq('game_slug', key)
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
    <main className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          Groups · {display}
        </h1>
        <Link to="/browse" className="text-sm underline">Back</Link>
      </div>

      {loading && <p className="mt-6 text-gray-600">Loading…</p>}
      {err && <p className="mt-6 text-red-600">Load error: {err}</p>}
      {!loading && !err && rows.length === 0 && <p className="mt-6 text-gray-600">No groups found.</p>}

      <ul className="mt-6 grid gap-4">
        {rows.map(g => (
          <li key={g.id} className="border rounded-xl p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">
                {(g.name || (g as any).title || (g as any).group_name || 'Untitled group')}
              </h2>
              <span className="text-xs px-2 py-1 rounded border">
                {g.is_online ? 'Online' : 'In-person'}
              </span>
            </div>
            {g.description && <p className="mt-2 text-sm text-gray-700">{g.description}</p>}
            <div className="mt-2 text-sm text-gray-600">
              Game: {g.game} · Category: {g.category}{g.city ? ` · City: ${g.city}` : ''}
            </div>
            {g.is_online && g.online_link && (
              <a className="mt-3 inline-block text-sm underline" href={g.online_link} target="_blank" rel="noreferrer">
                Join link
              </a>
            )}
            <div className="mt-4 flex gap-2">
              {memberOf.has(g.id) ? (
                <Link
                  to={`/group/${g.id}`}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-black/[0.04]"
                >
                  View
                </Link>
              ) : (
                <button
                  onClick={() => joinGroup(g.id)}
                  disabled={joiningId === g.id}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                >
                  {joiningId === g.id ? 'Joining…' : 'Join'}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}