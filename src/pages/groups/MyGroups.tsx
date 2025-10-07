import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';


type Group = {
  id: string;
  title?: string | null;
  name?: string | null;
  group_name?: string | null;
  purpose?: string | null;
  game?: string | null;
  category?: string | null;
  capacity?: number | null;
  visibility?: string | null;
  host_id?: string | null;
  is_online?: boolean | null;
  online_link?: string | null;
  location?: string | null;
  created_at?: string | null;
};

type Member = {
  user_id: string;
  role: string | null;
  status: string | null;
  created_at: string | null;
  profiles: {
    user_id: string;
    name: string | null;
  } | null;
};

export default function GroupDetail() {
  const { id } = useParams<{ id: string }>();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Minimal group fetch by id only (no extra filters)
  useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      setErr(null);

      // Log route + session for quick diagnosis
      const { data: session } = await supabase.auth.getSession();
      console.debug('[GroupDetail] fetching group', { id, uid: session?.session?.user?.id });

      const { data, error, status } = await supabase
        .from('groups')
        .select('id, title, name, group_name, purpose, game, category, capacity, visibility, host_id, is_online, online_link, location, created_at')
        .eq('id', id)
        .maybeSingle();

      if (ignore) return;

      if (error) {
        console.error('[GroupDetail] groups fetch error', { status, error });
        setErr(`fetch_failed:${status}:${error.code}:${error.message}`);
        setGroup(null as any);
        setLoading(false);
        return;
      }

      if (!data) {
        console.warn('[GroupDetail] no row for id', id);
        setErr('not_found');
        setGroup(null as any);
        setLoading(false);
        return;
      }

      setGroup(data as any);
      setLoading(false);
    })();
    return () => { ignore = true; };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data, error } = await supabase
        .from('group_members')
        .select('user_id, role, status, created_at, profiles(user_id, name)')
        .eq('group_id', id)
        .order('created_at', { ascending: true });

      if (error) {
        setErr(error.message);
        return;
      }
      setMembers(
        (data || []).map((m: any) => ({
          ...m,
          profiles: Array.isArray(m.profiles) ? m.profiles[0] || null : m.profiles ?? null,
        }))
      );
    })();
  }, [id]);

  if (!group && !loading) {
    return <div className="p-6">Group not found. <span className="text-xs text-neutral-500">id={id}</span></div>;
  }

  return (
    <main className="max-w-5xl mx-auto p-6">
      {loading && <p>Loading group details...</p>}
      {err && <p className="text-red-600">{err}</p>}
      {group && (
        <>
          <h1 className="text-3xl font-bold">{group.title || group.name || group.group_name || 'Untitled Group'}</h1>
          <p>{group.purpose}</p>
          <div>
            <strong>Game:</strong> {group.game} &nbsp;
            <strong>Category:</strong> {group.category} &nbsp;
            <strong>Capacity:</strong> {group.capacity} &nbsp;
            <strong>Visibility:</strong> {group.visibility} &nbsp;
            <strong>Location:</strong> {group.location} &nbsp;
            <strong>Online:</strong> {group.is_online ? 'Yes' : 'No'} &nbsp;
            {group.is_online && group.online_link && (
              <a href={group.online_link} target="_blank" rel="noopener noreferrer" className="underline text-blue-600">Online Link</a>
            )}
          </div>
          <h2 className="mt-6 text-xl font-semibold">Members</h2>
          <ul>
            {members.map(m => (
              <li key={m.user_id} className="border-b py-2">
                {m.profiles?.name || m.user_id} - {m.role} - {m.status}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}