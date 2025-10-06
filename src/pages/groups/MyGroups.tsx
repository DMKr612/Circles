import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from "../../lib/supabase";

type Group = {
  id: string;
  name?: string | null;
  title?: string | null;
  group_name?: string | null;
  description: string | null;
  game: string | null;
  category: string | null;
  is_online: boolean | null;
  online_link: string | null;
  city: string | null;
  __role?: string; // from group_members.role
};

export default function MyGroups() {
  const [rows, setRows] = useState<Group[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { user }, error: uErr } = await supabase.auth.getUser();
      if (uErr || !user) { if (mounted) { setErr('Sign in required'); setLoading(false); } return; }

      const { data, error } = await supabase
        .from('group_members')
        .select('role, groups(*)')
        .eq('user_id', user.id);

      if (!mounted) return;
      if (error) { setErr(error.message); setLoading(false); return; }

      const rowsWithRole: Group[] = (data ?? [])
        .filter((r: any) => r.groups)
        .map((r: any) => ({ ...r.groups, __role: r.role }));
      setRows(rowsWithRole);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <main className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My Groups</h1>
        <Link to="/browse" className="text-sm underline">Back</Link>
      </div>

      {loading && <p className="mt-6 text-gray-600">Loading…</p>}
      {err && <p className="mt-6 text-red-600">{err}</p>}
      {!loading && !err && rows.length === 0 && <p className="mt-6 text-gray-600">You haven’t joined any groups yet.</p>}

      <ul className="mt-6 grid gap-4">
        {rows.map(g => (
          <li key={g.id} className="border rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Link to={`/group/${g.id}`} className="text-lg font-medium underline-offset-2 hover:underline">
                  {(g.name || g.title || g.group_name || 'Untitled group')}
                </Link>
                {g.__role && (
                  <span className="text-[11px] px-2 py-0.5 rounded border">
                    {g.__role.toLowerCase() === 'owner' || g.__role.toLowerCase() === 'host' ? 'Host' : 'Member'}
                  </span>
                )}
              </div>
              <span className="text-xs px-2 py-1 rounded border">
                {g.is_online ? 'Online' : 'In-person'}
              </span>
            </div>
            {g.description && <p className="mt-2 text-sm text-gray-700">{g.description}</p>}
            <div className="mt-2 text-sm text-gray-600">
              Game: {g.game} · Category: {g.category}{g.city ? ` · City: ${g.city}` : ''}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}