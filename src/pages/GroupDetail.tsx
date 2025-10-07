import { useEffect, useState, useRef, type FormEvent } from "react";
import type React from "react";
import { useParams, useNavigate, Link } from "react-router-dom";

import { supabase } from "../lib/supabase";
console.log('[SUPABASE]', import.meta.env?.VITE_SUPABASE_URL, String((import.meta.env?.VITE_SUPABASE_ANON_KEY||'')).slice(0,8));


// --- Types ---
 type Group = {
  id: string;
  host_id: string;
  title: string;
  purpose: string | null; // description
  category: string | null;
  capacity: number;
  visibility: string | null;
  is_online: boolean;
  online_link: string | null;
  location: string | null;
  created_at: string;
};

 type Message = {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  created_at: string;
  profiles?: { name: string | null } | null;
};

type Poll = { id: string; group_id: string; title: string; status: string; closes_at: string | null; created_by: string };
type PollOption = { id: string; poll_id: string; label: string; starts_at: string | null; place: string | null };
type Member = { user_id: string; role: string | null; name: string | null; created_at: string };

export default function GroupDetail() {
  const { id = "" } = useParams<{ id: string }>();
  console.debug("[GroupDetail] route id =", id);
  const nav = useNavigate();

  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);

  // Chat modal state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatFull, setChatFull] = useState(false);

  // Voting state
  const [poll, setPoll] = useState<Poll | null>(null);
  const [options, setOptions] = useState<PollOption[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [memberCount, setMemberCount] = useState<number>(0);
  const [votedCount, setVotedCount] = useState<number>(0);
  const [votingBusy, setVotingBusy] = useState<string | null>(null); // option_id being cast
  const [members, setMembers] = useState<Member[]>([]);
  const [isMember, setIsMember] = useState(false);
  // --- Friend actions state ---
  type FriendState = 'none' | 'pending_in' | 'pending_out' | 'accepted' | 'blocked';
  const [friendStatus, setFriendStatus] = useState<Record<string, FriendState>>({});
  const [viewOpen, setViewOpen] = useState(false);
  const [viewUserId, setViewUserId] = useState<string | null>(null);
  const [viewUserName, setViewUserName] = useState<string>('');
  const [viewStats, setViewStats] = useState<{ games: number; friends: number; created: number } | null>(null);
  const [viewBusy, setViewBusy] = useState(false);
  // Create-vote modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("Schedule");
  const [newOptions, setNewOptions] = useState(""); // one label per line

  useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      const { data: auth } = await supabase.auth.getUser();
      if (!ignore) setMe(auth.user?.id ?? null);

      let row: any = null;
      let fetchErr: any = null;

      // try a narrow select first
      // simple: select everything to avoid schema drift issues
      const q = await supabase
        .from('groups')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (q.error) fetchErr = q.error;
      row = q.data as any;

      if (fetchErr) {
        console.warn('[GroupDetail] fetch error', fetchErr);
        if (!ignore) setMsg(`${fetchErr.code||'err'}:${fetchErr.message}`);
      }
      if (!ignore) setGroup((row as Group) ?? null);

      // count active members for voting stats
      if (row?.id) {
        const { count, error: cErr } = await supabase
          .from('group_members')
          .select('*', { count: 'exact', head: true })
          .eq('group_id', row.id)
          .eq('status', 'active');
        if (!ignore) setMemberCount(count ?? 0);
        if (cErr) console.warn('[GroupDetail] member count error', cErr);
      }

      setLoading(false);
    })();
    return () => { ignore = true; };
  }, [id]);
  useEffect(() => {
    let off = false;
    (async () => {
      if (!group?.id) { setMembers([]); return; }
    let dataRes = await supabase
      .from('group_members')
      .select('user_id, role, created_at, profiles(user_id, name)')
      .eq('group_id', group.id)
      .eq('status', 'active')
      .order('created_at', { ascending: true });

      let rows: any[] = dataRes.data || [];
      if (dataRes.error) {
        // fallback without join, fetch names separately
        const bare = await supabase
          .from('group_members')
          .select('user_id, role, created_at')
          .eq('group_id', group.id)
          .eq('status', 'active')
          .order('created_at', { ascending: true });
        rows = bare.data || [];
      }

      const arr = (rows ?? []).map((r: any) => ({
        user_id: r.user_id as string,
        role: (r.role as string) ?? null,
        created_at: r.created_at as string,
        name: r.profiles?.name ?? null,
      }));
      if (off) return;
      setMembers(arr as Member[]);
      // am I a member?
      const meId = (await supabase.auth.getUser()).data.user?.id || null;
      if (meId) setIsMember(arr.some((a: any) => a.user_id === meId));
      // refresh friend statuses for visible members
      if (meId) await refreshFriendStatuses(arr.map((a: any) => a.user_id));
    })();
    return () => { off = true; };
  }, [group?.id]);

    useEffect(() => {
    let off = false;
    (async () => {
      if (!viewOpen || !viewUserId) { setViewStats(null); return; }
      setViewBusy(true);
      const [gmCount, frCount, createdCount] = await Promise.all([
        supabase
          .from('group_members')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', viewUserId)
          .eq('status', 'active'),
        supabase
          .from('friendships')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'accepted')
          .or(`user_id_a.eq.${viewUserId},user_id_b.eq.${viewUserId}`),
        supabase
          .from('groups')
          .select('*', { count: 'exact', head: true })
          .eq('host_id', viewUserId),
      ]);
      if (off) return;
      setViewStats({
        games: (gmCount.count as number | null) ?? 0,
        friends: (frCount.count as number | null) ?? 0,
        created: (createdCount.count as number | null) ?? 0,
      });
      setViewBusy(false);
    })();
    return () => { off = true; };
  }, [viewOpen, viewUserId]);

  async function leaveGroup() {
    if (!group) return;
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) { setMsg("Please sign in."); return; }
    if (uid === group.host_id) { setMsg("Host cannot leave their own group."); return; }
    setMsg(null);
    const { error } = await supabase
      .from("group_members")
      .delete()
      .match({ group_id: group.id, user_id: uid });
    if (error) { setMsg(error.message); return; }
    // refresh members
    const { data } = await supabase
      .from("group_members")
      .select("user_id, role, created_at, profiles(user_id, name)")
      .eq("group_id", group.id)
      .eq("status", "active")
      .order("created_at", { ascending: true });
    const arr = (data ?? []).map((r: any) => ({
      user_id: r.user_id as string,
      role: (r.role as string) ?? null,
      created_at: r.created_at as string,
      name: r.profiles?.name ?? null,
    }));
    setMembers(arr as Member[]);
    setIsMember(false);
    setMsg("You left the group.");
  }

  // Host-only: remove a member from this group
async function removeMember(userId: string) {
  if (!group) return;
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) { setMsg("Please sign in."); return; }
  if (uid !== group.host_id) { setMsg("Only the host can remove members."); return; }
  if (userId === group.host_id) { setMsg("Host cannot remove themselves."); return; }

  const ok = window.confirm("Remove this member from the group?");
  if (!ok) return;

  setMsg(null);
  const { error } = await supabase
    .from("group_members")
    .delete()
    .match({ group_id: group.id, user_id: userId });

  if (error) { setMsg(error.message); return; }

  // optimistic UI update
  setMembers(prev => prev.filter(m => m.user_id !== userId));
  setMemberCount(prev => Math.max(0, (prev || 1) - 1));
}

  useEffect(() => {
    let gone = false;
    (async () => {
      if (!group?.id) { setPoll(null); setOptions([]); setCounts({}); setVotedCount(0); return; }
      // latest open poll
      const { data: polls, error: pErr } = await supabase
        .from("group_polls").select("*")
        .eq("group_id", group.id)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1);
      if (gone) return;
      if (pErr) { setMsg(pErr.message); return; }
      const cur = (polls && polls[0]) as Poll | undefined;
      setPoll(cur || null);
      if (!cur) { setOptions([]); setCounts({}); setVotedCount(0); return; }

      // options
      const { data: opts } = await supabase
        .from("group_poll_options")
        .select("*")
        .eq("poll_id", cur.id)
        .order("created_at");
      if (gone) return;
      setOptions((opts as PollOption[]) || []);

      // vote counts per option (client-side aggregate to avoid TS issues)
      const { data: votesRows } = await supabase
        .from("group_votes")
        .select("option_id,user_id")
        .eq("poll_id", cur.id);
      if (gone) return;
      const map: Record<string, number> = {};
      const voterSet = new Set<string>();
      (votesRows as Array<{ option_id: string; user_id: string }> | null)?.forEach((r) => {
        map[r.option_id] = (map[r.option_id] || 0) + 1;
        voterSet.add(r.user_id);
      });
      setCounts(map);
      setVotedCount(voterSet.size);
    })();
    return () => { gone = true; };
  }, [group?.id]);

async function joinGroup() {
  setMsg(null);
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) { setMsg("Please sign in."); return; }
  if (!id) { setMsg("Invalid group id"); return; }

  const { error } = await supabase
    .from("group_members")
    .insert({ group_id: id as string, user_id: auth.user.id });

  // ignore unique violation (already a member)
  if (error && error.code !== "23505") { setMsg(error.message); return; }

  setIsMember(true);

  // refresh list + count
  const { data } = await supabase
    .from("group_members")
    .select("user_id, role, created_at, profiles(user_id, name)")
    .eq("group_id", id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  const arr = (data ?? []).map((r: any) => ({
    user_id: r.user_id as string,
    role: (r.role as string) ?? null,
    created_at: r.created_at as string,
    name: r.profiles?.name ?? null,
  }));
  setMembers(arr as Member[]);
  setMemberCount(arr.length);
}

  // ===== Friend helpers =====
  function deriveStatus(row: any, me: string): FriendState {
    if (!row) return 'none';
    if (row.status === 'accepted') return 'accepted';
    if (row.status === 'blocked') return 'blocked';
    if (row.status === 'pending') {
      return row.requested_by === me ? 'pending_out' : 'pending_in';
    }
    return 'none';
  }

  async function refreshFriendStatuses(memberIds: string[]) {
    const u = (await supabase.auth.getUser()).data.user;
    if (!u) return;
    const ids = memberIds.filter((id) => id !== u.id);
    if (ids.length === 0) { setFriendStatus({}); return; }

    const { data: rels } = await supabase
      .from('friendships')
      .select('user_id_a,user_id_b,status,requested_by')
      .or(
        ids
          .map(id => `and(user_id_a.eq.${u.id},user_id_b.eq.${id}),and(user_id_a.eq.${id},user_id_b.eq.${u.id})`)
          .join(',')
      );

    const map: Record<string, FriendState> = {};
    ids.forEach(id => {
      const r = (rels ?? []).find(rr =>
        (rr.user_id_a === u.id && rr.user_id_b === id) ||
        (rr.user_id_b === u.id && rr.user_id_a === id)
      );
      map[id] = deriveStatus(r, u.id);
    });
    setFriendStatus(map);
  }

  async function sendFriendRequest(targetId: string) {
    await supabase.rpc('request_friend', { target_id: targetId });
    await refreshFriendStatuses([targetId]);
  }

  async function acceptFriend(fromId: string) {
    await supabase.rpc('accept_friend', { from_id: fromId });
    await refreshFriendStatuses([fromId]);
  }

  async function removeFriend(otherId: string) {
    await supabase.rpc('remove_friend', { other_id: otherId });
    await refreshFriendStatuses([otherId]);
  }

  function openMemberView(userId: string, name: string) {
    setViewUserId(userId);
    setViewUserName(name);
    setViewOpen(true);
  }
  // ===========================

  async function handleDelete() {
    if (!group || !me) return;
    const ok = window.confirm("Delete this group? This cannot be undone.");
    if (!ok) return;
    setMsg(null);
    const { error } = await supabase
      .from("groups")
      .delete()
      .match({ id: group.id, host_id: me });
    if (error) { setMsg(error.message); return; }
    nav("/browse");
  }

  async function createVoting() {
    if (!group) return;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) { setMsg("Please sign in."); nav("/login"); return; }
    if (auth.user.id !== group.host_id) { setMsg("Only the host can create a vote."); return; }
    setNewTitle("Schedule");
    setNewOptions("");
    setCreateOpen(true);
  }

  async function confirmCreateVoting() {
    if (!group) return;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) { setMsg("Please sign in."); nav("/login"); return; }
    if (auth.user.id !== group.host_id) { setMsg("Only the host can create a vote."); return; }

    const { data: created, error: pErr } = await supabase
      .from("group_polls")
      .insert({ group_id: group.id, title: (newTitle || "Schedule").trim(), created_by: auth.user.id })
      .select("id")
      .single();
    if (pErr || !created?.id) { setMsg(pErr?.message || "Failed to create poll"); return; }

    const labels = (newOptions || "")
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 20);
    if (labels.length) {
      const rows = labels.map(label => ({ poll_id: created.id, label }));
      const { error: oErr } = await supabase.from("group_poll_options").insert(rows);
      if (oErr) { setMsg(oErr.message); return; }
    }

    setCreateOpen(false);
    setMsg("Voting created");
    window.location.hash = "polls";

    setPoll({ id: created.id, group_id: group.id, title: (newTitle || "Schedule").trim(), status: "open", closes_at: null, created_by: auth.user.id });
    const { data: opts } = await supabase
      .from("group_poll_options").select("*")
      .eq("poll_id", created.id)
      .order("created_at");
    setOptions((opts as PollOption[]) || []);
    setCounts({});
    setTimeout(() => document.getElementById("polls")?.scrollIntoView({ behavior: "smooth" }), 0);
  }

  async function castVote(optionId: string): Promise<void> {
    if (!poll) return;
    setVotingBusy(optionId);
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) { setMsg("Please sign in."); nav("/login"); setVotingBusy(null); return; }
    // ensure membership before voting (RLS requires member or host)
    await supabase
      .from("group_members")
      .upsert(
        { group_id: poll.group_id, user_id: uid, role: me === group?.host_id ? "host" : "member" },
        { onConflict: "group_id,user_id" }
      );
    const { error } = await supabase
      .from("group_votes")
      .upsert(
        { poll_id: poll.id, option_id: optionId, user_id: uid },
        { onConflict: "poll_id,user_id" }
      );
    if (error) { setMsg(error.message); setVotingBusy(null); return; }
    const { data: votesRows } = await supabase
      .from("group_votes")
      .select("option_id,user_id")
      .eq("poll_id", poll.id);
    const map: Record<string, number> = {};
    const voterSet = new Set<string>();
    (votesRows as Array<{ option_id: string; user_id: string }> | null)?.forEach((r) => {
      map[r.option_id] = (map[r.option_id] || 0) + 1;
      voterSet.add(r.user_id);
    });
    setCounts(map);
    setVotedCount(voterSet.size);
    setVotingBusy(null);
  }

  if (loading) return (
    <div className="p-8 grid place-items-center">
      <div className="flex items-center gap-3 text-neutral-600">
        <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        <span>Loading…</span>
      </div>
    </div>
  );
  if (msg && !group && !loading) {
    return (
      <div className="p-6 space-y-2">
        <div className="text-red-700 text-sm font-semibold">Error loading group</div>
        <div className="text-xs break-words text-red-800">{msg}</div>
        <div className="text-[10px] text-neutral-500">id={id}</div>
      </div>
    );
  }
  if (!group) return <div className="p-6">Group not found. <span className="text-xs text-neutral-500">id={id}</span></div>;

return (
<>
  <div className={"transition-all duration-300 " + (chatOpen && !chatFull ? "mr-[min(92vw,520px)]" : "") }>
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        {/* Left: Members */}
        <aside className="order-2 lg:order-1 rounded-2xl border border-black/10 bg-white p-4 h-max shadow">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">Members</h2>
            <span className="text-xs text-neutral-600">{memberCount}</span>
          </div>
          <ul className="mt-3 space-y-2">
            {members.map((m) => {
              const isHost = m.user_id === group!.host_id;
              const label = m.name ?? m.user_id.slice(0, 6);
              return (
                <li key={m.user_id} className="flex items-center justify-between rounded-xl border border-black/10 px-2.5 py-1.5 text-sm bg-neutral-50">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 grid place-items-center rounded-full ring-1 ring-black/10 dark:ring-white/10 bg-gradient-to-br from-neutral-100 to-neutral-200 dark:from-neutral-800 dark:to-neutral-700 text-[11px] font-medium">
                      {label.slice(0, 2).toUpperCase()}
                    </div>
                    <button
                      onClick={() => openMemberView(m.user_id, label)}
                      className="text-neutral-900 underline-offset-2 hover:underline"
                    >
                      {label}
                    </button>
                    {me === group!.host_id && m.user_id !== group!.host_id && (
                      <button
                        onClick={() => removeMember(m.user_id)}
                        className="ml-1 text-[11px] rounded border border-black/10 px-2 py-0.5 hover:bg-black/5"
                        title="Remove from group"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {isHost && (
                      <span className="text-[10px] rounded-full bg-amber-500/15 text-amber-700 px-2 py-0.5">HOST</span>
                    )}
                  </div>
                </li>
              );
            })}

            {members.length === 0 && <li className="text-xs text-neutral-600">No members yet.</li>}
          </ul>
        </aside>

        {/* Right: Main content */}
        <div className="order-1 lg:order-2">
          {/* Header + Overview */}
          <div className="rounded-2xl border border-black/10 bg-white p-5 shadow">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Link to="/browse" className="text-xs text-neutral-500 hover:underline">Browse</Link>
                  <span className="text-neutral-300">/</span>
                  <span className="text-xs text-neutral-700">Group</span>
                  <span className="hidden sm:inline text-neutral-300">·</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                    {group!.category || "Uncategorized"}
                  </span>
                </div>
                <h1 className="truncate text-3xl font-bold tracking-tight text-neutral-900">{group!.title}</h1>
                <div className="mt-1 text-xs text-neutral-500">Created {new Date(group!.created_at).toLocaleDateString()} • Host: {members.find(m => m.user_id === group!.host_id)?.name || group!.host_id.slice(0,6)}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!isMember && (
                  <button onClick={joinGroup} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">Join</button>
                )}
                {isMember && me !== group!.host_id && (
                  <button onClick={leaveGroup} className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm font-medium hover:bg-black/[0.04]">Leave</button>
                )}
                <button onClick={() => setChatOpen(true)} className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm font-medium hover:bg-black/[0.04]">Open Chat</button>
                {me === group!.host_id && (
                  <>
                    <button onClick={createVoting} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">Create Voting</button>
                    <button onClick={handleDelete} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">Delete</button>
                  </>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h2 className="text-sm font-semibold text-neutral-900">About</h2>
                <p className="mt-1 text-sm text-neutral-700 whitespace-pre-wrap">{group!.purpose || "No description yet."}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm text-neutral-700">
                <div>Capacity: <span className="font-medium text-neutral-900">{group!.capacity}</span></div>
                <div>Visibility: <span className="font-medium text-neutral-900">{group!.visibility || "private"}</span></div>
                <div>Format: <span className="font-medium text-neutral-900">{group!.is_online ? "Online" : "In person"}</span></div>
                {group!.is_online && group!.online_link && (
                  <div className="col-span-2 truncate">Link: <a className="text-emerald-600 hover:underline" href={group!.online_link ?? '#'} target="_blank" rel="noreferrer">{group!.online_link}</a></div>
                )}
                {!group!.is_online && group!.location && (
                  <div className="col-span-2">Location: <span className="font-medium text-neutral-900">{group!.location}</span></div>
                )}
              </div>
            </div>
          </div>

          {/* Voting Section */}
          <section id="polls" className="mt-6 rounded-2xl border border-black/10 bg-white p-5 shadow">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-neutral-900">Voting</h2>
              {me === group!.host_id && poll && <span className="text-xs text-neutral-600">Open</span>}
            </div>

            {!poll && <div className="mt-2 text-sm text-neutral-600">No active voting.</div>}

            {poll && (
              <div className="mt-3">
                <div className="text-sm text-neutral-700">{poll.title}</div>
                <ul className="mt-3 space-y-2">
                  {options.map((o) => (
                    <li key={o.id} className="flex items-center justify-between rounded-xl border border-black/10 px-3 py-2 bg-neutral-50">
                      <div><div className="font-medium text-neutral-900">{o.label}</div></div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-neutral-600">{counts[o.id] ?? 0} votes</span>
                        <button
                          onClick={() => castVote(o.id)}
                          disabled={!!votingBusy}
                          className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {votingBusy === o.id ? (
                            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                            </svg>
                          ) : null}
                          Vote
                        </button>
                      </div>
                    </li>
                  ))}
                  {options.length === 0 && <li className="text-sm text-neutral-600">No options yet.</li>}
                </ul>
                <div className="mt-3 text-xs text-neutral-600">Voters: {votedCount} / Members: {memberCount}</div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  </div>

    {createOpen && (
      <div className="fixed inset-0 z-50">
        <div className="absolute inset-0 bg-black/50" onClick={() => setCreateOpen(false)} />
        <div className="absolute left-1/2 top-1/2 w-[min(92vw,600px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900">
          <h3 className="text-lg font-semibold">Create Voting</h3>
          <label className="mt-3 block text-sm">Title</label>
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="mt-1 w-full rounded border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-neutral-800 dark:text-gray-100" />
          <label className="mt-3 block text-sm">Options (one per line)</label>
          <textarea value={newOptions} onChange={(e) => setNewOptions(e.target.value)} rows={6} placeholder={"Sat 19:00 @ Tacheles\nSun 18:00 @ Niko Club"} className="mt-1 w-full rounded border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-neutral-800 dark:text-gray-100" />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setCreateOpen(false)} className="rounded-md border px-3 py-1.5 text-sm">Cancel</button>
            <button type="button" onClick={confirmCreateVoting} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white">Create</button>
          </div>
        </div>
      </div>
    )}

    {chatOpen && (
     <ChatPanel
        groupId={group!.id}
        onClose={() => { setChatOpen(false); setChatFull(false); }}
        full={chatFull}
        setFull={setChatFull}
      />
    )}
    {viewOpen && viewUserId && (
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/40">
        <div className="w-[420px] max-w-[92vw] rounded-2xl border border-black/10 bg-white p-5 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-base font-semibold">{viewUserName}</div>
            <button onClick={() => setViewOpen(false)} className="rounded-md border px-2 py-1 text-sm">Close</button>
          </div>
          <div className="space-y-3 text-sm">
            {/* Stats strip */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-black/10 bg-neutral-50 p-2 text-center">
                <div className="text-[11px] text-neutral-600">Games Played</div>
                <div className="text-lg font-semibold text-neutral-900">{viewStats?.games ?? (viewBusy ? '…' : 0)}</div>
              </div>
              <div className="rounded-lg border border-black/10 bg-neutral-50 p-2 text-center">
                <div className="text-[11px] text-neutral-600">Friends</div>
                <div className="text-lg font-semibold text-neutral-900">{viewStats?.friends ?? (viewBusy ? '…' : 0)}</div>
              </div>
              <div className="rounded-lg border border-black/10 bg-neutral-50 p-2 text-center">
                <div className="text-[11px] text-neutral-600">Groups Created</div>
                <div className="text-lg font-semibold text-neutral-900">{viewStats?.created ?? (viewBusy ? '…' : 0)}</div>
              </div>
            </div>

            {/* Friend actions (moved from list) */}
            {friendStatus[viewUserId] === 'accepted' && (
              <button onClick={() => removeFriend(viewUserId)} className="w-full rounded-md border px-3 py-2">
                Unfriend
              </button>
            )}
            {friendStatus[viewUserId] === 'none' && (
              <button onClick={() => sendFriendRequest(viewUserId)} className="w-full rounded-md bg-emerald-600 px-3 py-2 text-white">
                Add friend
              </button>
            )}
            {friendStatus[viewUserId] === 'pending_out' && <div>Request sent.</div>}
            {friendStatus[viewUserId] === 'pending_in' && (
              <button onClick={() => acceptFriend(viewUserId)} className="w-full rounded-md bg-emerald-600 px-3 py-2 text-white">
                Accept request
              </button>
            )}
          </div>
        </div>
      </div>
    )}
  </>
);
}

// --- Chat Panel (slide-in) ---
function ChatPanel({ groupId, onClose, full, setFull }: { groupId: string; onClose: () => void; full: boolean; setFull: (v: boolean) => void }) {
  // chat state
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [profileMap, setProfileMap] = useState<Record<string, string | null>>({});
  const [myId, setMyId] = useState<string | null>(null);
  const [myName, setMyName] = useState<string>("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [typingUsers, setTypingUsers] = useState<Record<string, { name: string; ts: number }>>({});
  const typingTimeoutRef = useRef<number | null>(null);

  // keyset pagination state for chat history
  const [oldestTs, setOldestTs] = useState<string | null>(null);
  const [oldestId, setOldestId] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const PAGE_SIZE = 50;

  // Load my id and my name
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id ?? null;
      setMyId(uid);
      if (uid) {
        const { data: p } = await supabase.from('profiles').select('name').eq('user_id', uid).maybeSingle();
        setMyName(p?.name || uid.slice(0,6));
      }
    })();
  }, []);

  // load history (latest first, then render ascending)
  useEffect(() => {
    let ignore = false;
    setInitialLoading(true);
    (async () => {
      // fetch newest PAGE_SIZE messages with keyset-friendly ordering
      const { data, error } = await supabase
        .from("group_messages")
        .select("id, group_id, user_id, content, created_at")
        .eq("group_id", groupId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);

      if (error) { if (!ignore) { setErr(error.message); setInitialLoading(false); } return; }
      if (ignore) { setInitialLoading(false); return; }

      const desc = (data ?? []).map((m: any) => ({
        id: m.id as string,
        group_id: m.group_id as string,
        user_id: m.user_id as string,
        content: (m.content ?? "") as string,
        created_at: m.created_at as string,
      }));

      // compute cursor from oldest item of this page (which is the last in desc list)
      const oldest = desc[desc.length - 1] || null;
      setOldestTs(oldest ? oldest.created_at : null);
      setOldestId(oldest ? oldest.id : null);
      setHasMore((desc.length === PAGE_SIZE));

      // render ascending for UI
      const asc = [...desc].reverse();
      setMsgs(asc as Message[]);

      // fetch distinct user names once
      const uids = Array.from(new Set(asc.map(m => m.user_id)));
      if (uids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, name")
          .in("user_id", uids);
        const map: Record<string, string | null> = {};
        (profs ?? []).forEach((p: any) => { map[p.user_id] = p.name ?? null; });
        if (!ignore) setProfileMap(map);
      }
      setInitialLoading(false);
    })();
    return () => { ignore = true; };
  }, [groupId]);

  // fetch older pages
  async function loadOlder() {
    if (!hasMore || loadingMore || !oldestTs || !oldestId) return;
    setLoadingMore(true);
    setErr(null);

    // keyset condition: created_at < cursor OR (created_at = cursor AND id < cursorId)
    const { data, error } = await supabase
      .from("group_messages")
      .select("id, group_id, user_id, content, created_at")
      .eq("group_id", groupId)
      .or(`created_at.lt.${oldestTs},and(created_at.eq.${oldestTs},id.lt.${oldestId})`)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE);

    if (error) { setErr(error.message); setLoadingMore(false); return; }

    const desc = (data ?? []).map((m: any) => ({
      id: m.id as string,
      group_id: m.group_id as string,
      user_id: m.user_id as string,
      content: (m.content ?? "") as string,
      created_at: m.created_at as string,
    }));

    // update cursor from the new oldest item (last in desc)
    const newOldest = desc[desc.length - 1] || null;
    setOldestTs(newOldest ? newOldest.created_at : oldestTs);
    setOldestId(newOldest ? newOldest.id : oldestId);
    setHasMore(desc.length === PAGE_SIZE);

    // prepend older messages (convert to ascending order before merge)
    const asc = [...desc].reverse();
    setMsgs(prev => [...asc, ...prev]);

    setLoadingMore(false);
  }

  // realtime (messages + typing)
  useEffect(() => {
    const channel = supabase
      .channel(`grp-msgs-${groupId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const m = payload.new as any;
          setMsgs(prev => [...prev, { id: m.id, group_id: m.group_id, user_id: m.user_id, content: (m.content ?? ""), created_at: m.created_at }]);
          // lazy-resolve name for new sender if missing
          if (!profileMap[m.user_id]) {
            supabase
              .from("profiles")
              .select("user_id, name")
              .eq("user_id", m.user_id)
              .maybeSingle()
              .then(({ data }) => {
                if (data) setProfileMap(prev => ({ ...prev, [data.user_id]: data.name ?? null }));
              });
          }
        }
        if (payload.eventType === 'DELETE') {
          const m = payload.old as any;
          setMsgs(prev => prev.filter(x => x.id !== m.id));
        }
        if (payload.eventType === 'UPDATE') {
          const m = payload.new as any;
          setMsgs(prev => prev.map(x => x.id === m.id ? { ...x, content: (m.content ?? "") } : x));
        }
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const { user_id, name } = payload as { user_id: string; name: string };
        if (!user_id || user_id === myId) return;
        setTypingUsers(prev => ({ ...prev, [user_id]: { name, ts: Date.now() } }));
        // auto-expire after 3s
        setTimeout(() => {
          setTypingUsers(prev => {
            const copy = { ...prev } as Record<string, { name: string; ts: number }>;
            if (copy[user_id] && Date.now() - copy[user_id].ts > 2500) delete copy[user_id];
            return copy;
          });
        }, 3000);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [groupId, myId, profileMap]);

  // autoscroll
  useEffect(() => {
  if (loadingMore) return;
  listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
}, [msgs.length, loadingMore]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setErr(null);
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) { setErr("Please sign in"); setSending(false); return; }
    const { error } = await supabase
      .from('group_messages')
      .insert({ group_id: groupId, user_id: user.id, content: body });
    if (error) {
      setErr(error.message);
    } else {
      setText("");
    }
    setSending(false);
  }

  return (
    <>
      {full && <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />}

      <div
        className={
          "fixed right-0 top-0 z-50 h-full transform transition-transform duration-300 " +
          (full ? "w-screen translate-x-0" : "w-[min(92vw,520px)] translate-x-0")
        }
      >
        <div className="flex h-full flex-col overflow-hidden rounded-none border-l border-black/10 bg-white shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-black/10 bg-white px-3 py-2">
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="rounded-md border border-black/10 px-2 py-1 text-sm">Close</button>
              <div>
                <div className="text-sm font-medium text-neutral-900">Group Chat</div>
                <div className="text-[11px] text-neutral-500">Visible to all members</div>
              </div>
            </div>
            <button onClick={() => setFull(!full)} className="rounded-md border border-black/10 px-2 py-1 text-sm">
              {full ? "Exit Fullscreen" : "Fullscreen"}
            </button>
          </div>

          {/* Messages */}
          <div ref={listRef} className="flex-1 overflow-y-auto bg-neutral-50 px-3 py-3">
            {/* Load older */}
            {hasMore && !initialLoading && (
              <div className="mb-2 flex justify-center">
                <button
                  onClick={loadOlder}
                  disabled={loadingMore}
                  className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-xs hover:bg-black/5 disabled:opacity-60"
                >
                  {loadingMore ? 'Loading…' : 'Load older'}
                </button>
              </div>
            )}
            {msgs.map(m => {
              const mine = myId && m.user_id === myId;
              const name = profileMap[m.user_id] ?? m.user_id.slice(0,6);
              return (
                <div key={m.id} className={`mb-2 flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-emerald-600 text-white' : 'bg-white border border-black/10'}`}>
                    {!mine && <div className="mb-0.5 text-[11px] font-medium text-neutral-600">{name}</div>}
                    <div className="whitespace-pre-wrap break-words">{m.content}</div>
                    <div className={`mt-1 text-[10px] ${mine ? 'text-emerald-50/80' : 'text-neutral-500'}`}>{new Date(m.created_at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</div>
                  </div>
                </div>
              );
            })}
            {msgs.length === 0 && !initialLoading && (
              <div className="text-center text-sm text-neutral-500">No messages yet.</div>
            )}
            {initialLoading && (
              <div className="flex justify-center py-6 text-neutral-400">
                <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              </div>
            )}
          </div>

          {/* Typing indicator */}
          {Object.keys(typingUsers).length > 0 && (
            <div className="px-3 py-1 text-[11px] text-neutral-500">
              {Object.values(typingUsers).map(t => t.name).join(', ')} typing…
            </div>
          )}

          {/* Composer */}
          <form onSubmit={send} className="border-t border-black/10 bg-white px-3 py-2">
            <div className="flex items-end gap-2">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onInput={() => {
                  if (!myId) return;
                  // throttle to once per 800ms
                  const now = Date.now();
                  if (typingTimeoutRef.current && now - typingTimeoutRef.current < 800) return;
                  typingTimeoutRef.current = now;
                  supabase.channel(`grp-msgs-${groupId}`).send({ type: 'broadcast', event: 'typing', payload: { user_id: myId, name: myName } });
                }}
                placeholder="Type a message…"
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    (e.currentTarget.form as HTMLFormElement)?.requestSubmit();
                  }
                }}
                className="min-h-[40px] max-h-40 flex-1 resize-none rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="submit"
                disabled={!text.trim() || sending || initialLoading}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {(sending || initialLoading) ? (
                  <span className="inline-flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a 8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    Sending…
                  </span>
                ) : 'Send'}
              </button>
            </div>
            {err && <div className="mt-1 text-xs text-red-600">{err}</div>}
          </form>
        </div>
      </div>
    </>
  );
}
