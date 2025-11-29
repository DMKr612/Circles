import { useEffect, useState, useRef, lazy, Suspense, type FormEvent } from "react";
import { useParams, useNavigate, Link, useLocation } from "react-router-dom";

import { supabase } from "@/lib/supabase";
import type { Group, Message, Poll, PollOption, GroupMember } from "@/types";
console.log('[SUPABASE]', import.meta.env?.VITE_SUPABASE_URL, String((import.meta.env?.VITE_SUPABASE_ANON_KEY||'')).slice(0,8));


const ChatPanel = lazy(() => import("../components/ChatPanel"));

export default function GroupDetail() {
  const { id = "" } = useParams<{ id: string }>();
  console.debug("[GroupDetail] route id =", id);
  const nav = useNavigate();
  const location = useLocation();

  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Share invite state
  const [shareBusy, setShareBusy] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  // I am host if I match host_id or creator_id (used across UI)
  const isHost = !!(me && group && (me === group.host_id || (group?.creator_id ?? null) === me));

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
  const [members, setMembers] = useState<GroupMember[]>([]);
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
  const [newOptions, setNewOptions] = useState<string>("");
  const [pollDuration, setPollDuration] = useState("24h");
  const [customEndDate, setCustomEndDate] = useState<string>("");
  async function copyGroupCode() {
    if (!group?.code) return;
    try {
      await navigator.clipboard.writeText(String(group.code));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.warn('Clipboard failed', e);
    }
  }

  // Share invite: create an invite link and copy to clipboard
  async function createInvite() {
    if (!group?.id) return;
    try {
      setShareBusy(true);
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) {
        // send to onboarding, then bounce back
        localStorage.setItem('postLoginRedirect', window.location.pathname);
        window.location.href = `${window.location.origin}/onboarding`;
        return;
      }
      const { data: code, error } = await supabase.rpc('make_group_invite', {
        p_group_id: group.id,
        p_hours: 168,     // 7 days; set null for no expiry
        p_max_uses: null  // unlimited; set a number to cap
      });
      if (error) { setMsg(error.message); return; }
      const url = `${window.location.origin}/invite/${code}`;
      try { await navigator.clipboard.writeText(url); setShareCopied(true); setTimeout(()=>setShareCopied(false), 1500); } catch {}
    } finally {
      setShareBusy(false);
    }
  }
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
    if (location.hash === '#chat') {
      setChatOpen(true);
    }
  }, [location.hash]);
  useEffect(() => {
    let off = false;
    (async () => {
      if (!group?.id) { setMembers([]); return; }
    let dataRes = await supabase
      .from('group_members')
      .select('user_id, role, created_at, status, group_id, profiles(user_id, name)')
      .eq('group_id', group.id)
      .eq('status', 'active')
      .order('created_at', { ascending: true });

      let rows: any[] = dataRes.data || [];
      if (dataRes.error) {
        // fallback without join, fetch names separately
        const bare = await supabase
          .from('group_members')
          .select('user_id, role, created_at, status, group_id')
          .eq('group_id', group.id)
          .eq('status', 'active')
          .order('created_at', { ascending: true });
        rows = bare.data || [];
      }

      const arr = (rows ?? []).map((r: any) => ({
        user_id: r.user_id as string,
        role: (r.role as string) ?? null,
        created_at: r.created_at as string,
        group_id: (r.group_id as string) ?? group.id,
        status: (r.status as string) ?? 'active',
        name: r.profiles?.name ?? null,
      }));
      if (off) return;
      setMembers(arr);
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
      .select("user_id, role, created_at, status, group_id, profiles(user_id, name)")
      .eq("group_id", group.id)
      .eq("status", "active")
      .order("created_at", { ascending: true });
    const arr = (data ?? []).map((r: any) => ({
      user_id: r.user_id as string,
      role: (r.role as string) ?? null,
      created_at: r.created_at as string,
      group_id: (r.group_id as string) ?? group.id,
      status: (r.status as string) ?? "active",
      name: r.profiles?.name ?? null,
    }));
    setMembers(arr);
    setIsMember(false);
    setMsg("You left the group.");
  }

  // Host-only: remove a member from this group
async function removeMember(userId: string) {
  if (!group) return;
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) { setMsg("Please sign in."); return; }
  if (!isHost) { setMsg("Only the host can remove members."); return; }
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
    .select("user_id, role, created_at, status, group_id, profiles(user_id, name)")
    .eq("group_id", id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  const arr = (data ?? []).map((r: any) => ({
    user_id: r.user_id as string,
    role: (r.role as string) ?? null,
    created_at: r.created_at as string,
    group_id: (r.group_id as string) ?? (group?.id ?? id),
    status: (r.status as string) ?? "active",
    name: r.profiles?.name ?? null,
  }));
  setMembers(arr);
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
    if (!isHost) { setMsg("Only the host can create a vote."); return; }
    // Auto-delete current ongoing voting before creating a new one
    if (poll?.id) {
      await supabase.from("group_polls").delete().eq("id", poll.id);
      setPoll(null);
      setOptions([]);
      setCounts({});
      setVotedCount(0);
    }
    setNewTitle("Schedule");
    setNewOptions("");
    setCreateOpen(true);
  }

  async function confirmCreateVoting() {
    if (!group) return;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) { setMsg("Please sign in."); nav("/login"); return; }
    if (!isHost) { setMsg("Only the host can create a vote."); return; }

    const { data: created, error: pErr } = await supabase
      .from("group_polls")
      .insert({ group_id: group.id, title: (newTitle || "Schedule").trim(), created_by: auth.user.id })
      .select("id")
      .single();
    if (pErr || !created?.id) { setMsg(pErr?.message || "Failed to create poll"); return; }

    let labels = (newOptions || "")
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 20);

    if (!labels.some(l => l.toLowerCase() === "not coming")) {
      labels.push("Not Coming");
    }
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

  async function finalizePoll() {
    if (!poll || !isHost) return;

    const ok = window.confirm("End voting and count participants?");
    if (!ok) return;

    try {
      setVotingBusy("closing");

      const { error } = await supabase.rpc("resolve_poll", {
        p_poll_id: poll.id,
      });

      if (error) throw error;

      setPoll(prev => prev ? { ...prev, status: "closed" } : prev);
      setMsg("Poll finalized and game stats updated!");
    } catch (err: any) {
      setMsg(err.message || "Error finalizing poll");
    } finally {
      setVotingBusy(null);
    }
  }

  async function deleteVoting() {
    if (!poll) return;
    const ok = window.confirm("Delete this voting?");
    if (!ok) return;

    // delete votes
    await supabase
      .from("group_votes")
      .delete()
      .eq("poll_id", poll.id);

    // delete options
    await supabase
      .from("group_poll_options")
      .delete()
      .eq("poll_id", poll.id);

    // delete poll
    const { error } = await supabase
      .from("group_polls")
      .delete()
      .eq("id", poll.id);

    if (error) { setMsg(error.message); return; }

    // reset UI
    setPoll(null);
    setOptions([]);
    setCounts({});
    setVotedCount(0);
    setMsg("Voting deleted.");
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
  <div className={
    "transition-all duration-300 " +
    (chatOpen && !chatFull ? "lg:mr-[min(92vw,520px)]" : "")
  }>
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-[200px_1fr]">
        {/* Left: Members */}
        <aside className="order-2 lg:order-1 rounded-xl border border-black/10 bg-white p-3 h-max shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">Members</h2>
            <span className="text-xs text-neutral-600">{memberCount}</span>
          </div>
          <ul className="mt-3 space-y-2">
            {members.map((m) => {
              const memberIsHost = m.user_id === group!.host_id;
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
                    {isHost && m.user_id !== group!.host_id && (
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
                    {memberIsHost && (
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
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Link to="/browse" className="text-xs text-neutral-500 hover:underline">Browse</Link>
                  <span className="text-neutral-300">/</span>
                  <span className="text-xs text-neutral-700">Group</span>
                  <span className="hidden sm:inline text-neutral-300">·</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                    {group!.category || "Uncategorized"}
                  </span>
                  {group!.city && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                      {group!.city}
                    </span>
                  )}
                </div>
                <h1 className="truncate text-3xl font-bold tracking-tight text-neutral-900">{group!.title}</h1>
                <div className="mt-1 text-xs text-neutral-500">Created {new Date(group!.created_at).toLocaleDateString()} • Host: {members.find(m => m.user_id === group!.host_id)?.name || group!.host_id.slice(0,6)}</div>
                {group!.code && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                      Code: {String(group!.code).toUpperCase()}
                    </span>
                    <button
                      onClick={copyGroupCode}
                      className="rounded border border-black/10 bg-white px-2 py-0.5 hover:bg-black/[0.04]"
                      title="Copy group code"
                    >
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                    <Link
                      to={`/browse?code=${group!.code}`}
                      className="text-emerald-700 hover:underline"
                      title="Open this group in Browse by code"
                    >
                      Open in Browse
                    </Link>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2 w-full sm:w-auto">
                <button
                  onClick={() => { setChatOpen(true); setChatFull(true); }}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                >
                  💬 Chat
                </button>
                {!isMember && (
                  <button onClick={joinGroup} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">Join</button>
                )} 
                {isMember && me !== group!.host_id && (
                  <button onClick={leaveGroup} className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm font-medium hover:bg-black/[0.04]">Leave</button>
                )}
                <button onClick={() => setChatOpen(true)} className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm font-medium hover:bg-black/[0.04]">Open Chat</button>
                {isHost && (
                  <>
                    <button
                      onClick={createInvite}
                      disabled={shareBusy}
                      className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm font-medium hover:bg-black/[0.04] disabled:opacity-60"
                      title="Create an invite link and copy it"
                    >
                      {shareBusy ? 'Creating…' : (shareCopied ? 'Copied!' : 'Share invite')}
                    </button>
                    <button onClick={createVoting} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">Create Voting</button>
                    <button
                      onClick={handleDelete}
                      className="rounded-md border border-red-600 text-red-600 px-3 py-1.5 text-sm hover:bg-red-50"
                    >
                      Delete
                    </button>
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

                <div>City: <span className="font-medium text-neutral-900">{group!.city || "—"}</span></div>

                {group!.is_online && group!.online_link && (
                  <div className="col-span-2 truncate">Link: <a className="text-emerald-600 hover:underline" href={group!.online_link ?? '#'} target="_blank" rel="noreferrer">{group!.online_link}</a></div>
                )}
                {!group!.is_online && (group!.location || group!.city) && (
                  <div className="col-span-2">
                    Location: <span className="font-medium text-neutral-900">{group!.location || group!.city}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Voting Section */}
          <section id="polls" className="mt-6 rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-neutral-900">Voting</h2>
              {isHost && poll && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-600">Open</span>
                  {poll.status === "open" && (
                    <button
                      onClick={finalizePoll}
                      className="rounded-md bg-black text-white px-2 py-0.5 text-xs hover:bg-neutral-800"
                    >
                      End & Count Games
                    </button>
                  )}
                  <button
                    onClick={deleteVoting}
                    className="rounded-md border border-red-600 text-red-600 px-2 py-0.5 text-xs hover:bg-red-50"
                  >
                    Delete Voting
                  </button>
                </div>
              )}
            </div>

            {!poll && <div className="mt-2 text-sm text-neutral-600">No active voting.</div>}

            {poll && (
              <div className="mt-3">
                <div className="text-sm text-neutral-700">{poll.title}</div>
                <ul className="mt-3 space-y-2">
                  {options.map((o) => (
                    <li key={o.id} className="flex items-center justify-between rounded-xl border border-black/10 px-3 py-2 bg-neutral-50">
                      <div>
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.label)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-900"
                        >
                          {o.label}
                        </a>
                      </div>
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-black/5">
          
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-xl font-bold text-neutral-900">New Vote</h3>
            <button
              onClick={() => setCreateOpen(false)}
              className="rounded-full p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-4">
            {/* Title Input */}
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wide mb-1.5">Topic</label>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Where should we meet?"
                className="w-full rounded-xl border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm font-medium focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all outline-none"
              />
            </div>

            {/* Duration Selector */}
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wide mb-1.5">Duration</label>
              <div className="flex gap-2">
                <select
                  value={pollDuration}
                  onChange={(e) => setPollDuration(e.target.value)}
                  className="flex-1 rounded-xl border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm font-medium focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="1h">1 Hour</option>
                  <option value="24h">24 Hours</option>
                  <option value="48h">2 Days</option>
                  <option value="custom">Custom Date...</option>
                </select>

                {pollDuration === "custom" && (
                  <input
                    type="datetime-local"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="flex-[1.5] rounded-xl border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                )}
              </div>
            </div>

            {/* Options Input */}
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wide mb-1.5">Options</label>
              <textarea
                value={newOptions}
                onChange={(e) => setNewOptions(e.target.value)}
                rows={4}
                placeholder={"Option 1\nOption 2\nOption 3"}
                className="w-full rounded-xl border-neutral-200 bg-neutral-50 px-4 py-3 text-sm font-medium focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all outline-none resize-none"
              />
              <p className="mt-1.5 text-[10px] text-neutral-400 flex items-center gap-1">
                <span>ℹ️</span> "Not Coming" is added automatically.
              </p>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="mt-6 flex items-center justify-end gap-3 pt-4 border-t border-neutral-100">
            <button
              onClick={() => setCreateOpen(false)}
              className="rounded-xl px-5 py-2.5 text-sm font-bold text-neutral-500 hover:bg-neutral-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmCreateVoting}
              className="rounded-xl bg-black px-6 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-neutral-800 active:scale-95 transition-all"
            >
              Create Vote
            </button>
          </div>

        </div>
      </div>
    )}

    {chatOpen && group && (
      <Suspense
        fallback={
          <div className="fixed inset-0 grid place-items-center bg-black/40 text-white">
            Loading Chat...
          </div>
        }
      >
        <ChatPanel
          groupId={group!.id}
          onClose={() => { setChatOpen(false); setChatFull(false); }}
          full={chatFull}
          setFull={setChatFull}
        />
      </Suspense>
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
