import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

function fmtDate(d?: string | null) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString(); } catch { return ''; }
}

function Badge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${className}`}>{children}</span>
  );
}

export default function MyGroups() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) {
          setRows([]);
          return;
        }
        // 1) get group ids where I am a member
        const { data: mem, error: mErr } = await supabase
          .from('group_members')
          .select('group_id')
          .eq('user_id', uid);
        if (mErr) throw mErr;
        const ids = (mem ?? []).map((r: any) => r.group_id).filter(Boolean);
        if (ids.length === 0) {
          setRows([]);
          return;
        }
        // 2) load the groups
        const { data: gs, error: gErr } = await supabase
          .from('groups')
          .select('id, title, name, description, category, game, city, capacity, is_online, created_at')
          .in('id', ids)
          .order('created_at', { ascending: false });
        if (gErr) throw gErr;
        if (!active) return;
        setRows(gs ?? []);
      } catch (e: any) {
        if (!active) return;
        setErr(e?.message ?? 'Failed to load your groups');
        setRows([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:mb-8 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">My Groups</h1>
          <p className="mt-1 text-sm text-neutral-600">Groups you’ve joined or been added to.</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Link to="/browse" className="flex-1 rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04] sm:flex-none">Back</Link>
          <Link to="/create" className="flex-1 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 sm:flex-none">New Group</Link>
        </div>
      </div>

      {loading && (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
      )}

      {!!err && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
  {err}
</div>
      )}

      {!loading && !err && rows.length === 0 && (
        <div className="mt-6 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-black/10 bg-white/70 p-10 text-center text-neutral-600">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-70"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 3h10l4 7H3l4-7Z"/></svg>
          <div className="text-lg font-medium">No groups for “{''}”</div>
          <div className="text-sm">Be the first to create one.</div>
          <Link to="/create" className="mt-2 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:brightness-110">New Group</Link>
        </div>
      )}

      <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((g) => (
          <li key={g.id} className="group rounded-xl border border-black/10 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-base font-semibold text-neutral-900">{g.title || (g as any).name || (g as any).group_name || 'Untitled group'}</h2>
                  <Badge className={g.is_online ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-black/10 bg-neutral-50 text-neutral-700'}>{g.is_online ? 'Online' : 'In-person'}</Badge>
                </div>
                {g.description && <p className="mt-1 line-clamp-2 text-sm text-neutral-600">{g.description}</p>}
                <div className="mt-2 flex flex-wrap gap-1 text-xs text-neutral-700">
                  <Badge className="border-black/10 bg-neutral-50">{g.category ? `#${g.category}` : '#general'}</Badge>
                  {g.game && <Badge className="border-black/10 bg-neutral-50">{g.game}</Badge>}
                  {g.city && <Badge className="border-black/10 bg-neutral-50">{g.city}</Badge>}
                  {g.capacity && <Badge className="border-black/10 bg-neutral-50">{g.capacity} slots</Badge>}
                  {g.created_at && <Badge className="border-black/10 bg-neutral-50">{fmtDate(g.created_at)}</Badge>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link to={`/group/${g.id}`} className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04]">View</Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}